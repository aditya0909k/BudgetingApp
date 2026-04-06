require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Data layer ──────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const FILES = {
  accounts:          path.join(DATA_DIR, 'accounts.json'),
  budget:            path.join(DATA_DIR, 'budget.json'),
  excluded:          path.join(DATA_DIR, 'excluded.json'),
  weeklyHistory:     path.join(DATA_DIR, 'weeklyHistory.json'),
  monthlyHistory:    path.join(DATA_DIR, 'monthlyHistory.json'),
  txnCache:          path.join(DATA_DIR, 'transactions_cache.json'),
};

const DEFAULTS = {
  accounts:       { enrollments: [] },
  budget:         { weeklyBudget: 250 },
  excluded:       { excludedIds: [] },
  weeklyHistory:  {},
  monthlyHistory: {},
  txnCache:       { fetchedAt: null, enrollmentIds: [], transactions: [], enrollmentErrors: [] },
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const [key, filePath] of Object.entries(FILES)) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(DEFAULTS[key], null, 2));
    }
  }
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`readJSON error for ${filePath}:`, e.message);
    return null;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`writeJSON error for ${filePath}:`, e.message);
  }
}

// Migrate old Plaid accounts.json (items → enrollments) if needed
function migrateAccounts() {
  const data = readJSON(FILES.accounts);
  if (data && data.items && !data.enrollments) {
    writeJSON(FILES.accounts, { enrollments: [] });
    console.log('[migrate] Cleared old Plaid accounts.json → fresh enrollments');
  }
}

// ─── Teller API ───────────────────────────────────────────────────────────────

function loadCertValue(val) {
  if (!val) return null;
  if (val.includes('-----BEGIN')) return val;
  if ((val.includes('/') || val.includes('.')) && !val.includes(' ') && val.length < 200) {
    const p = path.isAbsolute(val) ? val : path.join(__dirname, val);
    try { return fs.readFileSync(p, 'utf8'); } catch (e) {
      console.error('[teller] could not read cert file:', p, e.message);
      return null;
    }
  }
  const tag = val.replace(/\s/g, '').length > 800 ? 'RSA PRIVATE KEY' : 'CERTIFICATE';
  return `-----BEGIN ${tag}-----\n${val.replace(/\s/g, '').match(/.{1,64}/g).join('\n')}\n-----END ${tag}-----\n`;
}

function makeTellerAgent() {
  const cert = loadCertValue(process.env.TELLER_CERT);
  const key  = loadCertValue(process.env.TELLER_KEY);
  if (!cert || !key) {
    console.warn('[teller] No certificate/key — API calls will fail.');
    return null;
  }
  try {
    return new https.Agent({ cert, key });
  } catch (e) {
    console.error('[teller] agent error:', e.message);
    return null;
  }
}

function tellerGet(urlPath, accessToken) {
  return new Promise((resolve, reject) => {
    const agent = makeTellerAgent();
    const options = {
      hostname: 'api.teller.io',
      port: 443,
      path: urlPath,
      method: 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(accessToken + ':').toString('base64'),
      },
      ...(agent ? { agent } : {}),
    };

    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
          else reject(new Error(`Teller ${res.statusCode}: ${JSON.stringify(parsed)}`));
        } catch {
          reject(new Error(`Teller parse error (${res.statusCode}): ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function normalizeTellerTxn(t, institutionName, lastFour) {
  return {
    transaction_id:  t.id,
    account_id:      t.account_id,
    name:            t.description,
    merchant_name:   t.details?.counterparty?.name || null,
    amount:          parseFloat(t.amount),   // positive = charge, negative = payment/credit
    date:            t.date,
    pending:         t.status === 'pending',
    category:        t.details?.category ? [t.details.category] : [],
    institutionName,
    accountMask:     lastFour || null,
  };
}

// ─── Transaction cache ───────────────────────────────────────────────────────
// Caches ALL posted (non-pending) transactions from Teller.
// Requests just filter by date from the cache — no live API call needed.
//
// Strategy:
//   cache age < FRESH_MS  → serve cache, no background fetch
//   cache age < STALE_MS  → serve cache, kick off background fetch
//   cache age > STALE_MS  → wait for fresh fetch (first load / very stale)

const CACHE_TTL = 60 * 60 * 1000;  // 60 minutes

let _fetchInProgress = false;

// Fetch ALL posted transactions from Teller and write to cache file.
async function fetchAndCacheAll(enrollments) {
  if (_fetchInProgress) return null;
  _fetchInProgress = true;
  const enrollmentIds = enrollments.map(e => e.enrollmentId);
  const all = [];
  const enrollmentErrors = [];

  for (const enr of enrollments) {
    try {
      const accounts = await tellerGet('/accounts', enr.accessToken);
      for (const acct of accounts) {
        const txns = await tellerGet(`/accounts/${acct.id}/transactions`, enr.accessToken);
        for (const t of txns) {
          all.push(normalizeTellerTxn(t, enr.institutionName, acct.last_four));
        }
      }
    } catch (e) {
      console.error(`[teller] fetch error for ${enr.enrollmentId}:`, e.message);
      enrollmentErrors.push({
        enrollmentId:    enr.enrollmentId,
        institutionName: enr.institutionName,
        error:           e.message,
      });
    }
  }

  const cache = { fetchedAt: new Date().toISOString(), enrollmentIds, transactions: all, enrollmentErrors };
  writeJSON(FILES.txnCache, cache);
  console.log(`[cache] refreshed — ${all.length} transactions, ${enrollmentErrors.length} errors`);
  _fetchInProgress = false;
  return cache;
}

// Returns { transactions, enrollmentErrors, fromCache }.
// Transactions are already filtered to posted-only; caller still filters by date.
async function getTransactions(enrollments) {
  const cache = readJSON(FILES.txnCache) || {};
  const enrollmentIds = enrollments.map(e => e.enrollmentId);

  // Invalidate if enrollment list changed
  const sameEnrollments = JSON.stringify(cache.enrollmentIds) === JSON.stringify(enrollmentIds);
  const ageMs = cache.fetchedAt ? Date.now() - new Date(cache.fetchedAt).getTime() : Infinity;

  if (sameEnrollments && cache.transactions && ageMs < CACHE_TTL) {
    // Fresh cache (< 60 min) — return immediately, no Teller call
    return { transactions: cache.transactions, enrollmentErrors: cache.enrollmentErrors || [], fromCache: true };
  }

  if (sameEnrollments && cache.transactions) {
    // Stale cache (> 60 min) — return immediately, refresh Teller in background
    setImmediate(() => fetchAndCacheAll(enrollments).catch(() => {}));
    return { transactions: cache.transactions, enrollmentErrors: cache.enrollmentErrors || [], fromCache: true };
  }

  // Cold (no cache at all) — fetch now and wait
  const fresh = await fetchAndCacheAll(enrollments);
  if (!fresh) {
    // Another fetch was already in progress — return stale if available
    return {
      transactions:    cache.transactions || [],
      enrollmentErrors: cache.enrollmentErrors || [],
      fromCache:       true,
    };
  }
  return { transactions: fresh.transactions, enrollmentErrors: fresh.enrollmentErrors, fromCache: false };
}

// Invalidate the transaction cache (e.g. after re-linking an account)
function invalidateCache() {
  writeJSON(FILES.txnCache, DEFAULTS.txnCache);
}

// ─── Week/month helpers ───────────────────────────────────────────────────────

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getCurrentWeekRange() {
  const now = new Date();
  const sunday = new Date(now); sunday.setDate(now.getDate() - now.getDay());
  const saturday = new Date(sunday); saturday.setDate(sunday.getDate() + 6);
  return { startDate: toDateStr(sunday), endDate: toDateStr(saturday) };
}

function getCurrentMonthRange() {
  const now = new Date();
  return {
    startDate: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    endDate:   toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function getWeekKey(startDate) {
  const d = new Date(startDate + 'T00:00:00');
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function getMonthKey(date) {
  const d = new Date(date + 'T00:00:00');
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function monthLabel(k) {
  const [year, month] = k.split('-');
  return `${MONTH_NAMES[parseInt(month, 10) - 1]} ${year}`;
}

// ─── Snapshotting ─────────────────────────────────────────────────────────────
// Uses the cache — no extra Teller calls.

async function runSnapshot() {
  try {
    const { enrollments } = readJSON(FILES.accounts) || { enrollments: [] };
    if (!enrollments.length) return;

    const { excludedIds } = readJSON(FILES.excluded) || { excludedIds: [] };
    const excludedSet = new Set(excludedIds);
    const { weeklyBudget } = readJSON(FILES.budget) || { weeklyBudget: 250 };

    const weekRange  = getCurrentWeekRange();
    const monthRange = getCurrentMonthRange();

    const { transactions: all } = await getTransactions(enrollments);

    const filterRange = (start, end) =>
      all.filter(t => t.date >= start && t.date <= end);

    const weekTxns  = filterRange(weekRange.startDate, weekRange.endDate);
    const monthTxns = filterRange(monthRange.startDate, monthRange.endDate);

    const spent = txns =>
      txns
        .filter(t => !excludedSet.has(t.transaction_id) && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0);

    const weekSpent  = spent(weekTxns);
    const monthSpent = spent(monthTxns);

    if (weekSpent > 0) {
      const weekKey = getWeekKey(weekRange.startDate);
      const history = readJSON(FILES.weeklyHistory) || {};
      history[weekKey] = { weekKey, startDate: weekRange.startDate, endDate: weekRange.endDate, totalSpent: parseFloat(weekSpent.toFixed(2)), weeklyBudget };
      writeJSON(FILES.weeklyHistory, history);
    }

    if (monthSpent > 0) {
      const monthKey = getMonthKey(monthRange.startDate);
      const history = readJSON(FILES.monthlyHistory) || {};
      history[monthKey] = { monthKey, label: monthLabel(monthKey), startDate: monthRange.startDate, endDate: monthRange.endDate, totalSpent: parseFloat(monthSpent.toFixed(2)), weeklyBudget };
      writeJSON(FILES.monthlyHistory, history);
    }

    console.log(`[snapshot] week=${weekSpent.toFixed(2)} month=${monthSpent.toFixed(2)}`);
  } catch (e) {
    console.error('[snapshot] error:', e.message);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /link  — PIN-protected
app.get('/link', (req, res) => {
  const LINK_PIN = process.env.LINK_PIN;
  const submittedPin = req.query.pin;

  // Show PIN entry form if pin is wrong or missing
  if (!LINK_PIN || submittedPin !== LINK_PIN) {
    const showError = typeof submittedPin !== 'undefined'; // only show error after an attempt
    const pinForm = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Link Bank Account</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0f1e;color:#fff;font-family:-apple-system,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;gap:20px;text-align:center;padding:24px}
    h1{font-size:22px;font-weight:700}
    p{color:#8892a4;font-size:15px}
    input{background:#1a2235;color:#fff;border:1px solid #2d3a50;border-radius:10px;
          padding:14px 20px;font-size:24px;letter-spacing:8px;text-align:center;
          width:180px;outline:none}
    input:focus{border-color:#4ade80}
    button{background:#4ade80;color:#000;border:none;padding:14px 36px;
           border-radius:10px;font-size:16px;font-weight:700;cursor:pointer}
    .err{color:#f87171;font-size:14px}
  </style>
</head>
<body>
  <h1>Link Bank Account</h1>
  <p>Enter your PIN to continue</p>
  <form method="GET" action="/link">
    <input type="password" name="pin" inputmode="numeric" maxlength="8" autofocus autocomplete="off" placeholder="••••"/>
    ${showError ? '<p class="err">Incorrect PIN</p>' : '<p>&nbsp;</p>'}
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html');
    return res.status(showError ? 403 : 200).send(pinForm);
  }

  const appId = process.env.TELLER_APPLICATION_ID;
  if (!appId) {
    return res.status(500).send('<pre>TELLER_APPLICATION_ID not set</pre>');
  }
  const env = process.env.TELLER_ENV || 'sandbox';
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Link Bank Account</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0f1e;color:#fff;font-family:-apple-system,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;gap:20px;text-align:center;padding:24px}
    h1{font-size:22px;font-weight:700}
    p{color:#8892a4;font-size:15px;max-width:360px}
    button{background:#4ade80;color:#000;border:none;padding:14px 36px;
           border-radius:10px;font-size:16px;font-weight:700;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}
    #msg{font-size:14px;color:#8892a4;min-height:20px}
  </style>
</head>
<body>
  <h1>Link Bank Account</h1>
  <p>Teller Connect will open and walk you through connecting your bank.</p>
  <button id="btn">Connect Bank</button>
  <div id="msg"></div>
  <script src="https://cdn.teller.io/connect/connect.js"></script>
  <script>
    const msg = document.getElementById('msg');
    const btn = document.getElementById('btn');
    const connect = TellerConnect.setup({
      applicationId: ${JSON.stringify(appId)},
      environment: ${JSON.stringify(env)},
      products: ['transactions'],
      onSuccess: async function(enrollment) {
        btn.disabled = true;
        msg.textContent = 'Saving enrollment…';
        try {
          const r = await fetch('/api/save_enrollment', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({
              accessToken:     enrollment.accessToken,
              enrollmentId:    enrollment.enrollment.id,
              institutionName: enrollment.enrollment.institution.name,
              userId:          enrollment.user.id,
            })
          });
          const d = await r.json();
          if (d.success) {
            btn.textContent = '✓ Done';
            msg.style.color = '#4ade80';
            msg.textContent = 'Account linked! You can close this tab.';
          } else {
            btn.disabled = false;
            msg.style.color = '#f87171';
            msg.textContent = 'Error: ' + (d.error || 'unknown');
          }
        } catch(e) {
          btn.disabled = false;
          msg.style.color = '#f87171';
          msg.textContent = 'Error: ' + e.message;
        }
      },
      onExit: function() { msg.textContent = 'Cancelled.'; },
    });
    btn.addEventListener('click', function(){ connect.open(); });
    connect.open();
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// POST /api/save_enrollment
app.post('/api/save_enrollment', async (req, res) => {
  const { accessToken, enrollmentId, institutionName, userId } = req.body;
  if (!accessToken || !enrollmentId) {
    return res.status(400).json({ error: 'accessToken and enrollmentId are required' });
  }
  try {
    const tellerAccounts = await tellerGet('/accounts', accessToken);
    const accounts = tellerAccounts.map(a => ({
      id:       a.id,
      name:     a.name,
      lastFour: a.last_four,
      type:     a.type,
      subtype:  a.subtype,
    }));

    const data = readJSON(FILES.accounts) || { enrollments: [] };
    data.enrollments = data.enrollments.filter(e => e.enrollmentId !== enrollmentId);
    data.enrollments.push({ accessToken, enrollmentId, institutionName, userId, accounts });
    writeJSON(FILES.accounts, data);

    // New enrollment — clear the transaction cache so it re-fetches
    invalidateCache();

    res.json({ success: true, accounts });
  } catch (e) {
    console.error('save_enrollment error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/transactions
app.get('/api/transactions', async (req, res) => {
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }
  try {
    const { enrollments } = readJSON(FILES.accounts) || { enrollments: [] };
    if (req.query.force === 'true') invalidateCache();
    const { transactions: all, enrollmentErrors, fromCache } = await getTransactions(enrollments);

    // Filter to requested date range
    const transactions = all
      .filter(t => t.date >= startDate && t.date <= endDate)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const accountSummaries = enrollments.flatMap(enr =>
      enr.accounts.map(a => ({
        institutionName: enr.institutionName,
        accountId:       a.id,
        name:            a.name,
        mask:            a.lastFour,
        type:            a.type,
        itemId:          enr.enrollmentId,
      }))
    );

    res.json({ transactions, accounts: accountSummaries, enrollmentErrors });

    // Update history snapshot asynchronously (uses cache — free)
    if (!fromCache) setImmediate(() => runSnapshot().catch(() => {}));
  } catch (e) {
    console.error('transactions error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/accounts
app.get('/api/accounts', (req, res) => {
  const { enrollments } = readJSON(FILES.accounts) || { enrollments: [] };
  const accounts = enrollments.flatMap(enr =>
    enr.accounts.map(a => ({
      institutionName: enr.institutionName,
      accountId:       a.id,
      name:            a.name,
      mask:            a.lastFour,
      type:            a.type,
      itemId:          enr.enrollmentId,
    }))
  );
  res.json({ accounts });
});

// DELETE /api/accounts/:enrollmentId
app.delete('/api/accounts/:enrollmentId', (req, res) => {
  const { enrollmentId } = req.params;
  const data = readJSON(FILES.accounts) || { enrollments: [] };
  data.enrollments = data.enrollments.filter(e => e.enrollmentId !== enrollmentId);
  writeJSON(FILES.accounts, data);
  invalidateCache();
  res.json({ success: true });
});

// GET /api/budget
app.get('/api/budget', (req, res) => {
  const data = readJSON(FILES.budget) || { weeklyBudget: 250 };
  res.json({ weeklyBudget: data.weeklyBudget });
});

// POST /api/budget
app.post('/api/budget', (req, res) => {
  const { weeklyBudget } = req.body;
  if (!weeklyBudget || typeof weeklyBudget !== 'number' || weeklyBudget <= 0) {
    return res.status(400).json({ error: 'weeklyBudget must be a positive number' });
  }
  writeJSON(FILES.budget, { weeklyBudget });
  res.json({ success: true, weeklyBudget });
});

// GET /api/excluded
app.get('/api/excluded', (req, res) => {
  const data = readJSON(FILES.excluded) || { excludedIds: [] };
  res.json({ excludedIds: data.excludedIds });
});

// POST /api/excluded/toggle
app.post('/api/excluded/toggle', (req, res) => {
  const { transactionId } = req.body;
  const data = readJSON(FILES.excluded) || { excludedIds: [] };
  const idx = data.excludedIds.indexOf(transactionId);
  if (idx === -1) data.excludedIds.push(transactionId);
  else data.excludedIds.splice(idx, 1);
  writeJSON(FILES.excluded, data);
  res.json({ excludedIds: data.excludedIds });
});

// GET /api/history/weekly
app.get('/api/history/weekly', (req, res) => {
  const history = readJSON(FILES.weeklyHistory) || {};
  res.json({ history: Object.values(history).filter(e => e.totalSpent > 0).sort((a, b) => (a.weekKey < b.weekKey ? 1 : -1)) });
});

// GET /api/history/monthly
app.get('/api/history/monthly', (req, res) => {
  const history = readJSON(FILES.monthlyHistory) || {};
  res.json({ history: Object.values(history).filter(e => e.totalSpent > 0).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1)) });
});

// POST /api/history/update — called by detail screens to keep history totals in sync with exclusions
app.post('/api/history/update', (req, res) => {
  const { type, key, totalSpent } = req.body;
  if (type === 'weekly') {
    const history = readJSON(FILES.weeklyHistory) || {};
    if (history[key]) {
      history[key].totalSpent = parseFloat(parseFloat(totalSpent).toFixed(2));
      writeJSON(FILES.weeklyHistory, history);
    }
  } else if (type === 'monthly') {
    const history = readJSON(FILES.monthlyHistory) || {};
    if (history[key]) {
      history[key].totalSpent = parseFloat(parseFloat(totalSpent).toFixed(2));
      writeJSON(FILES.monthlyHistory, history);
    }
  }
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

ensureDataFiles();
migrateAccounts();

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Pre-warm the cache on startup so the first app open is fast
  setTimeout(async () => {
    const { enrollments } = readJSON(FILES.accounts) || { enrollments: [] };
    if (enrollments.length) {
      await getTransactions(enrollments).catch(() => {});
      await runSnapshot().catch(() => {});
    }
  }, 1000);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} in use — run:  bash start.sh\n`);
    process.exit(1);
  } else throw err;
});
