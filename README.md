# Personal Budgeting App

A personal finance tracker that runs as a native iOS app. Tracks weekly and monthly spending against a budget. Transactions are entered manually — you log what you spend as you go. The backend runs in the cloud 24/7.

> **Note on bank sync:** The app originally used Teller to sync bank transactions automatically. That integration still exists in the code but is effectively inactive (bank account was locked due to suspicious API attempts). The app now works entirely through manual transaction entry. If you want to re-enable Teller in the future, the infrastructure is still there — just re-link the bank via Settings → Add Account.

---

## How It Works

Two pieces:

1. **Backend (server)** — runs on Fly.io (~$0.34/month, not free). Stores all your data permanently. Always online, no Mac required once deployed.
2. **iPhone app** — talks to the backend. Built locally and sideloaded via Sideloadly.

---

## What You Need

- A Mac with Xcode installed (free from Mac App Store, ~15 GB)
- An iPhone
- A free Apple ID
- A Fly.io account (requires payment method, costs ~$0.34/month)
- Node.js and flyctl installed on your Mac
- Sideloadly installed on your Mac ([sideloadly.io](https://sideloadly.io))

---

## Mac Setup

Open **Terminal** (press `Command + Space`, type Terminal, press Enter).

### Install Homebrew
```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### Install Node.js and flyctl
```
brew install node
brew install flyctl
```

### Install Xcode
Open the **Mac App Store**, search "Xcode", install it (~15 GB).

---

## Part 1 — Backend (Fly.io)

### Create a Fly.io account
Go to [fly.io](https://fly.io), sign up, add a payment method.

### Log in
```
fly auth login
```

### Navigate to the server folder
```
cd ~/Documents/BudgetingApp/server
```

### Create the app
```
fly launch --name my-budget-server --region ewr --no-deploy
```
Replace `my-budget-server` with any name you like. `ewr` = New Jersey. Alternatives: `ord` (Chicago), `lax` (LA), `sea` (Seattle).

Answer prompts: No to Postgres, No to Redis, No to Tigris, Yes to existing config.

### Create a storage volume
This is where all your data lives permanently.
```
fly volumes create data_vol --size 1 --region ewr
```
Use the same region as above.

### Deploy
```
fly deploy
```
Takes ~2 minutes. Note the URL shown — something like `https://my-budget-server-XXXX.fly.dev`.

### Update the app URL
Open `mobile/src/config.js` and set:
```js
export const API_BASE_URL = 'https://my-budget-server-XXXX.fly.dev';
```

---

## Part 2 — iPhone App

### Important: no spaces in folder path
Xcode breaks if your project folder path has spaces. Make sure it's `BudgetingApp` (not `Budgeting App`).

### Install dependencies
```
cd ~/Documents/BudgetingApp/mobile
npm install
```

### Generate the Xcode project (first time only, or after adding native packages)
```
npx expo prebuild --platform ios --clean
```

### Build the IPA

Run these commands in Terminal:

```bash
# Step 1: Clean old build artifacts (important — stale archives cause silent failures)
rm -rf /tmp/BudgetingApp.xcarchive /tmp/IPAPayload /tmp/BudgetingApp.ipa

# Step 2: Archive (takes ~5-10 minutes)
cd ~/Documents/BudgetingApp/mobile
xcodebuild -workspace ios/BudgetingApp.xcworkspace \
  -scheme BudgetingApp \
  -configuration Release \
  -archivePath /tmp/BudgetingApp.xcarchive \
  CODE_SIGNING_ALLOWED=NO archive 2>&1 | tail -5
```

You should see `** ARCHIVE SUCCEEDED **`. Then:

```bash
# Step 3: Package as IPA
mkdir -p /tmp/IPAPayload/Payload
cp -R /tmp/BudgetingApp.xcarchive/Products/Applications/BudgetingApp.app /tmp/IPAPayload/Payload/
cd /tmp/IPAPayload && zip -r /tmp/BudgetingApp.ipa Payload
cp /tmp/BudgetingApp.ipa ~/Desktop/BudgetingApp.ipa
```

`BudgetingApp.ipa` appears on your Desktop.

### Install on iPhone via Sideloadly
1. Open Sideloadly
2. Plug iPhone into Mac (or use WiFi if already paired)
3. Drag `BudgetingApp.ipa` into Sideloadly
4. Enter your Apple ID and click **Start**

First install: on your iPhone go to **Settings → General → VPN & Device Management** → tap your Apple ID → **Trust**.

### Certificate renewal (every 7 days with free Apple ID)
Sideloadly handles this automatically in the background when your iPhone is on the same WiFi as your Mac. Just keep Sideloadly running.

To renew manually: repeat the Build IPA + Sideloadly steps above.

---

## Using the App

### Adding transactions
Tap **Add Transaction** on the home screen. Enter a name, amount, and date. Transactions are stored on your server immediately.

Quick-select name chips (Food, Grocery) and date arrow buttons (`‹` `›`) make entry faster.

### Excluding transactions
Tap any transaction to exclude it from your budget totals. Tap again to re-include. Useful for transfers, refunds, or anything you don't want counted.

### Editing a transaction
Long-press any transaction to edit its amount or date. This is useful when a pending transaction posts with the wrong date, or you want to split it into a different week.

- **Manual transactions** (ones you entered): shows a Delete button
- **Edited transactions**: shows a Reset button to undo

### Offline mode
If you have no internet connection, the home screen loads from cached data and shows "Offline" in the banner. You can still add transactions — they're queued locally and sent to the server automatically the next time the app connects.

### Weekly / Monthly history
- **Weekly Spending** — tap any week to see its transactions
- **Monthly Spending** — tap any month to see its transactions
- History totals update automatically when you open a detail screen

### Settings
- **Weekly Budget** — change how much you want to spend per week. Monthly budget is calculated proportionally.
- **Theme** — light or dark mode
- **Accent Color** — choose from presets or enter a custom hex / use RGB sliders

---

## Updating After Code Changes

### Backend changes only
```
cd ~/Documents/BudgetingApp/server
fly deploy
```

### Mobile JS changes (most changes — no new native packages)
Just rebuild the IPA and re-sideload. No need to re-run `npx expo prebuild`. Always delete `/tmp/BudgetingApp.xcarchive` first so you don't get a stale build.

### Mobile changes that add a new native package
```
cd ~/Documents/BudgetingApp/mobile
npx expo prebuild --platform ios --clean
```
Then rebuild the IPA and re-sideload.

---

## Data & Privacy

All data stays on your own Fly.io server. Nothing goes to any third party. Data files on the server volume:

| File | Contents |
|---|---|
| `budget.json` | Weekly budget amount |
| `manual_transactions.json` | All transactions you've entered manually |
| `excluded.json` | Transaction IDs excluded from budget totals |
| `overrides.json` | Per-transaction amount and date edits |
| `weeklyHistory.json` | Past weekly spending snapshots |
| `monthlyHistory.json` | Past monthly spending snapshots |
| `accounts.json` | Teller bank connection (legacy, inactive) |
| `transactions_cache.json` | Teller transaction cache (legacy, inactive) |

---

## Troubleshooting

### "Could not reach server" / app shows error
- Run `fly status` in Terminal — server should be `started`
- Check `mobile/src/config.js` has the correct Fly.io URL
- Check server logs: `fly logs`

### Transactions I added aren't showing
- Pull down to refresh on the home screen
- If you added them while offline, they'll sync automatically when back online (look for the "queued" badge on the transaction)

### Weekly/monthly history totals look wrong
Open that week or month's detail screen — it recalculates and corrects the stored total automatically.

### Build fails with "No such file or directory" path with a space
Your project folder has a space. Rename to `BudgetingApp` (no space). Re-run `npx expo prebuild --platform ios --clean`.

### Build fails with pod/dependency errors
```
cd ~/Documents/BudgetingApp/mobile/ios
pod install
```
Then try building again.

### App won't open after 7 days
Certificate expired. Re-sideload the IPA via Sideloadly (or keep Sideloadly running for auto-renewal).

### Data missing after a redeploy
Data lives on the Fly.io volume and survives deploys. To verify:
```
fly ssh console -C "ls /data"
```

### Forgot the bank link PIN (for Teller, if re-enabling)
```
fly secrets set LINK_PIN=new_pin
fly deploy
```

### "command not found: brew / node / fly"
- brew: run the Homebrew install command from Mac Setup
- node: `brew install node`
- fly: `brew install flyctl`
