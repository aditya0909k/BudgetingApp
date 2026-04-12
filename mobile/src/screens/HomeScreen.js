import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { useFocusEffect } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { getCurrentWeekRange, getTodayStr, formatCurrency, formatDateHeader } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import ArcGauge from '../components/ArcGauge';
import TransactionRow from '../components/TransactionRow';
import AccountFilterDropdown from '../components/AccountFilterDropdown';
import SkeletonRow from '../components/SkeletonRow';

const CACHE_KEY = 'home_week_cache';
const QUEUE_KEY = 'offline_tx_queue';

// Simple recursive-descent expression evaluator: supports +, -, *, /, ()
function calcEval(expr) {
  const s = expr.replace(/\s/g, '');
  let pos = 0;
  function parseExpr() {
    let v = parseTerm();
    while (pos < s.length && (s[pos] === '+' || s[pos] === '-')) {
      const op = s[pos++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (pos < s.length && (s[pos] === '*' || s[pos] === '/')) {
      const op = s[pos++];
      const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (s[pos] === '(') { pos++; const v = parseExpr(); if (s[pos] === ')') pos++; return v; }
    if (s[pos] === '-') { pos++; return -parseFactor(); }
    let n = '';
    while (pos < s.length && (s[pos] >= '0' && s[pos] <= '9' || s[pos] === '.')) n += s[pos++];
    return parseFloat(n) || 0;
  }
  try {
    const result = parseExpr();
    return isFinite(result) ? Math.round(result * 100) / 100 : null;
  } catch { return null; }
}

async function flushOfflineQueue() {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const queue = JSON.parse(raw);
    if (!queue.length) return;
    const remaining = [];
    for (const tx of queue) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/transactions/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: tx.name, amount: tx.amount, date: tx.date }),
        });
        if (!res.ok) remaining.push(tx);
      } catch {
        remaining.push(tx);
      }
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  } catch {}
}

export default function HomeScreen() {
  const { weeklyBudget, excludedIds, toggleExcluded, overrides, theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [enrollmentErrors, setEnrollmentErrors] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [staleData, setStaleData] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

  // Gauge popover
  const [gaugePopover, setGaugePopover] = useState(false);

  // Add transaction modal
  const [addVisible, setAddVisible] = useState(false);
  const [addName, setAddName] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addDate, setAddDate] = useState(new Date());
  const [addDateOpen, setAddDateOpen] = useState(false);
  const [addNotes, setAddNotes] = useState('');

  // Calculator
  const [calcVisible, setCalcVisible] = useState(false);
  const [calcExpr, setCalcExpr] = useState('');

  const { startDate, endDate } = getCurrentWeekRange();
  const onlyManual = accounts.length === 0 || accounts.every(a => a.accountId === 'manual');

  const fetchData = useCallback(async (isRefresh = false) => {
    // Flush any queued offline transactions first
    await flushOfflineQueue();

    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);
    try {
      const { startDate, endDate } = getCurrentWeekRange();
      const res = await fetch(
        `${API_BASE_URL}/api/transactions?startDate=${startDate}&endDate=${endDate}${isRefresh ? '&force=true' : ''}`
      );
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const txns = data.transactions || [];
      const accts = data.accounts || [];
      setTransactions(txns);
      setAccounts(accts);
      setEnrollmentErrors(data.enrollmentErrors || []);
      setStaleData(data.staleData || false);
      setLastSuccessAt(data.lastSuccessAt || null);
      setSelectedAccountIds(prev => {
        const incoming = new Set(accts.map(a => a.accountId));
        if (prev === null) return incoming;
        const next = new Set(prev);
        for (const id of incoming) next.add(id);
        return next;
      });
      setLastRefreshed(new Date());
      setIsOffline(false);
      // Persist to cache for offline use
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({
        transactions: txns,
        accounts: accts,
        enrollmentErrors: data.enrollmentErrors || [],
        staleData: data.staleData || false,
        lastSuccessAt: data.lastSuccessAt || null,
      })).catch(() => {});
    } catch (e) {
      // Try loading cached data
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          const cachedTxns = cached.transactions || [];
          const cachedAccts = cached.accounts || [];
          setTransactions(cachedTxns);
          setAccounts(cachedAccts);
          setEnrollmentErrors(cached.enrollmentErrors || []);
          setStaleData(cached.staleData || false);
          setLastSuccessAt(cached.lastSuccessAt || null);
          setSelectedAccountIds(prev => {
            const incoming = new Set(cachedAccts.map(a => a.accountId));
            if (prev === null) return incoming;
            const next = new Set(prev);
            for (const id of incoming) next.add(id);
            return next;
          });
          setIsOffline(true);
          setFetchError(null);
        } else {
          setIsOffline(true);
          setFetchError(e.message || 'Could not reach server');
        }
      } catch {
        setIsOffline(true);
        setFetchError(e.message || 'Could not reach server');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    fetchData(true);
  }, [fetchData]);

  const filteredTransactions = useMemo(() => {
    const dateFiltered = transactions.filter(t => {
      const effectiveDate = overrides[t.transaction_id]?.date ?? t.date;
      return effectiveDate >= startDate && effectiveDate <= endDate;
    });
    let result;
    if (!selectedAccountIds) result = dateFiltered;
    else if (selectedAccountIds.size === 0) result = [];
    else if (selectedAccountIds.size === accounts.length) result = dateFiltered;
    else result = dateFiltered.filter(t => selectedAccountIds.has(t.account_id));
    return [...result].sort((a, b) => {
      const da = overrides[a.transaction_id]?.date ?? a.date;
      const db = overrides[b.transaction_id]?.date ?? b.date;
      return db.localeCompare(da);
    });
  }, [transactions, selectedAccountIds, accounts, overrides, startDate, endDate]);

  const totalSpent = useMemo(
    () =>
      filteredTransactions
        .filter(t => {
          if (excludedIds.has(t.transaction_id) || t.amount <= 0) return false;
          const effectiveDate = overrides[t.transaction_id]?.date ?? t.date;
          return effectiveDate >= startDate && effectiveDate <= endDate;
        })
        .reduce((s, t) => s + (overrides[t.transaction_id]?.amount ?? t.amount), 0),
    [filteredTransactions, excludedIds, overrides, startDate, endDate]
  );

  // Category breakdown for gauge popover
  const categoryBreakdown = useMemo(() => {
    const groups = {};
    for (const t of filteredTransactions) {
      if (excludedIds.has(t.transaction_id) || (overrides[t.transaction_id]?.amount ?? t.amount) <= 0) continue;
      const key = (t.name || t.merchant_name || 'Other').trim();
      const amt = overrides[t.transaction_id]?.amount ?? t.amount;
      groups[key] = (groups[key] || 0) + amt;
    }
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 4);
    const otherAmt = sorted.slice(4).reduce((s, [, v]) => s + v, 0);
    if (otherAmt > 0) top.push(['Other', otherAmt]);
    return top;
  }, [filteredTransactions, excludedIds, overrides]);

  // Split transactions: today vs older
  const todayStr = getTodayStr();
  const todayTxns = useMemo(
    () => filteredTransactions.filter(t => (overrides[t.transaction_id]?.date ?? t.date) === todayStr),
    [filteredTransactions, todayStr, overrides]
  );
  const todaySpent = useMemo(
    () => todayTxns.filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0).reduce((s, t) => s + (overrides[t.transaction_id]?.amount ?? t.amount), 0),
    [todayTxns, excludedIds, overrides]
  );
  const olderTxns = useMemo(
    () => filteredTransactions.filter(t => (overrides[t.transaction_id]?.date ?? t.date) !== todayStr),
    [filteredTransactions, todayStr, overrides]
  );

  // Group older transactions into date-bubble sections
  const olderSections = useMemo(() => {
    const groups = {};
    for (const t of olderTxns) {
      const d = overrides[t.transaction_id]?.date ?? t.date;
      if (!groups[d]) groups[d] = [];
      groups[d].push(t);
    }
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({ date, transactions: groups[date] }));
  }, [olderTxns, overrides]);

  function refreshedLabel() {
    const d = staleData && lastSuccessAt ? new Date(lastSuccessAt) : lastRefreshed;
    if (!d) return null;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[d.getMonth()];
    const day = d.getDate();
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `Synced ${mon} ${day}, ${h12}:${m} ${ampm}`;
  }

  const calcResult = useMemo(() => calcEval(calcExpr), [calcExpr]);

  function openCalc() {
    Keyboard.dismiss();
    setCalcExpr(addAmount || '');
    setCalcVisible(true);
  }

  const OPS = new Set(['+', '-', '*', '/']);
  const OP_MAP = { '−': '-', '÷': '/', '( )': '()' };

  function handleCalcInput(key) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === '⌫') { setCalcExpr(p => p.slice(0, -1)); return; }
    const char = OP_MAP[key] ?? key;
    if (char === '()') {
      setCalcExpr(p => {
        const open = (p.match(/\(/g) || []).length;
        const close = (p.match(/\)/g) || []).length;
        const unclosed = open - close;
        const last = p.slice(-1);
        const insertClose = unclosed > 0 && /[\d.)]/.test(last);
        return p + (insertClose ? ')' : '(');
      });
      return;
    }
    if (OPS.has(char)) {
      setCalcExpr(p => OPS.has(p.slice(-1)) ? p.slice(0, -1) + char : p + char);
      return;
    }
    if (key === '.') {
      setCalcExpr(p => {
        const lastNum = p.split(/[+\-*/()]/).pop();
        return lastNum.includes('.') ? p : p + '.';
      });
      return;
    }
    setCalcExpr(p => p + char);
  }

  function applyCalcResult() {
    const val = calcResult !== null ? calcResult : parseFloat(calcExpr) || 0;
    setAddAmount(val % 1 === 0 ? String(val) : val.toFixed(2));
    setCalcVisible(false);
  }

  function openAdd() {
    setAddName('Food');
    setAddAmount('');
    setAddDate(new Date());
    setAddDateOpen(false);
    setAddNotes('');
    setCalcVisible(false);
    setAddVisible(true);
  }

  async function submitAdd() {
    const amount = parseFloat(addAmount);
    if (!addName.trim() || !isFinite(amount) || amount <= 0) return;
    const d = addDate;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const txPayload = { name: addName.trim(), amount, date: dateStr, ...(addNotes.trim() ? { notes: addNotes.trim() } : {}) };
    setAddVisible(false);
    try {
      const res = await fetch(`${API_BASE_URL}/api/transactions/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(txPayload),
      });
      if (!res.ok) throw new Error('server error');
      fetchData();
    } catch {
      // Offline: queue it and add optimistically to local state
      const offlineId = `offline_${Date.now()}`;
      try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY) || '[]';
        const queue = JSON.parse(raw);
        queue.push({ ...txPayload, offlineId });
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      } catch {}
      setTransactions(prev => [...prev, {
        transaction_id: offlineId,
        name: txPayload.name,
        amount: txPayload.amount,
        date: txPayload.date,
        notes: txPayload.notes,
        account_id: 'manual',
        manual: true,
        offlineQueued: true,
      }]);
    }
  }

  async function handleDelete(transactionId) {
    if (transactionId.startsWith('offline_')) {
      // Remove from local state and offline queue
      setTransactions(prev => prev.filter(t => t.transaction_id !== transactionId));
      try {
        const raw = await AsyncStorage.getItem(QUEUE_KEY) || '[]';
        const queue = JSON.parse(raw);
        await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.filter(tx => tx.offlineId !== transactionId)));
      } catch {}
      return;
    }
    try {
      await fetch(`${API_BASE_URL}/api/transactions/${transactionId}`, { method: 'DELETE' });
      fetchData();
    } catch {}
  }

  const refreshedStr = refreshedLabel();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader onTransactionAdded={fetchData} />
      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Pressable onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGaugePopover(true); }} delayLongPress={400}>
              <ArcGauge spent={totalSpent} budget={weeklyBudget} accentColor={theme.accentColor} period="week" />
            </Pressable>

            {/* Bank status / Add transaction bar */}
            <View style={{
              marginHorizontal: 16,
              marginBottom: 8,
              padding: 12,
              borderRadius: 10,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: (isOffline || (staleData && enrollmentErrors.length > 0)) ? colors.warning : colors.border,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
            }}>
              {isOffline ? (
                <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
                  Offline
                </Text>
              ) : staleData && enrollmentErrors.length > 0 && (
                <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
                  Bank disconnected
                </Text>
              )}
              <Pressable
                onPress={openAdd}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accent }}
              >
                <Text style={{ color: '#000', fontWeight: '700', fontSize: 12 }}>Add Transaction</Text>
              </Pressable>
            </View>

            {/* Account filter + last refreshed — hidden when only manual */}
            {!onlyManual && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
                <AccountFilterDropdown
                  accounts={accounts}
                  selectedAccountIds={selectedAccountIds}
                  onChange={setSelectedAccountIds}
                />
                {refreshedStr && !isOffline && (
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{refreshedStr}</Text>
                )}
              </View>
            )}

            {loading && (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}

            {/* Single continuous transaction card */}
            {!loading && (todayTxns.length > 0 || olderSections.length > 0) && (
              <View style={{
                backgroundColor: colors.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                marginHorizontal: 16,
                marginTop: 8,
                overflow: 'hidden',
              }}>
                {/* Today section */}
                {todayTxns.length > 0 && (
                  <>
                    <DayHeader label="Today" daySpent={todaySpent} colors={colors} topBorder={false} />
                    {todayTxns.map(t => (
                      <TransactionRow key={t.transaction_id} transaction={t} isExcluded={excludedIds.has(t.transaction_id)} onPress={() => toggleExcluded(t.transaction_id)} onDelete={handleDelete} />
                    ))}
                  </>
                )}

                {/* Older sections */}
                {olderSections.map((section, idx) => {
                  const daySpent = section.transactions
                    .filter(t => !excludedIds.has(t.transaction_id) && (overrides[t.transaction_id]?.amount ?? t.amount) > 0)
                    .reduce((s, t) => s + (overrides[t.transaction_id]?.amount ?? t.amount), 0);
                  const showTopBorder = idx > 0 || todayTxns.length > 0;
                  return (
                    <React.Fragment key={section.date}>
                      <DayHeader label={formatDateHeader(section.date)} daySpent={daySpent} colors={colors} topBorder={showTopBorder} />
                      {section.transactions.map(t => (
                        <TransactionRow key={t.transaction_id} transaction={t} isExcluded={excludedIds.has(t.transaction_id)} onPress={() => toggleExcluded(t.transaction_id)} onDelete={handleDelete} />
                      ))}
                    </React.Fragment>
                  );
                })}
              </View>
            )}

            {/* Empty / error states */}
            {!loading && fetchError && (
              <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
                <Text style={{ color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{fetchError}</Text>
                <Pressable onPress={() => fetchData(true)} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent }}>
                  <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
                </Pressable>
              </View>
            )}
            {!loading && !fetchError && todayTxns.length === 0 && olderSections.length === 0 && (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Text style={{ color: colors.textMuted, fontSize: 15 }}>No transactions this week</Text>
              </View>
            )}

            {/* Footer */}
            {!loading && filteredTransactions.length > 0 && (
              <View style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>
                  {filteredTransactions.filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0).length} transactions
                </Text>
                <Text style={{ fontSize: 12, color: colors.textMuted }}>{formatCurrency(totalSpent)}</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={null}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />

      {/* Add Transaction Modal */}
      <Modal transparent visible={addVisible} animationType="fade" onRequestClose={() => setAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={() => setAddVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
              <View style={{ width: addDateOpen ? undefined : 300, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', padding: 24 }}>
                <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 16 }}>Add Transaction</Text>

                <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Name</Text>
                <TextInput
                  value={addName}
                  onChangeText={setAddName}
                  placeholder="e.g. Starbucks"
                  placeholderTextColor={colors.textMuted}
                  style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 15, marginBottom: 8 }}
                />
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
                  {['Food', 'Grocery', 'Misc'].map(label => (
                    <Pressable
                      key={label}
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddName(label); }}
                      style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: addName === label ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : addName === label ? colors.accent + '22' : colors.background })}
                    >
                      <Text style={{ fontSize: 12, color: addName === label ? colors.accent : colors.textMuted, fontWeight: '500' }}>{label}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddName(''); }}
                    style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                  >
                    <Text style={{ fontSize: 12, color: colors.textMuted, fontWeight: '500' }}>Clear</Text>
                  </Pressable>
                </View>

                <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Amount</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: calcVisible ? 10 : 14 }}>
                  <TextInput
                    value={addAmount}
                    onChangeText={setAddAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    style={{ flex: 1, backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 18, fontWeight: '600', textAlign: 'center' }}
                    selectTextOnFocus
                  />
                  <Pressable
                    onPress={openCalc}
                    style={({ pressed }) => ({ width: 48, borderRadius: 8, borderWidth: 1, borderColor: calcVisible ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background, alignItems: 'center', justifyContent: 'center' })}
                  >
                    <Text style={{ fontSize: 20, color: colors.textMuted }}>±</Text>
                  </Pressable>
                </View>

                {/* Calculator panel */}
                {calcVisible && (
                  <View style={{ backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 14 }}>
                    {/* Display */}
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', marginBottom: 8, minHeight: 22 }}>
                      {(calcExpr || '0').replace(/\*/g, '×').replace(/\//g, '÷')}
                      {calcResult !== null && calcExpr ? ` = ${calcResult}` : ''}
                    </Text>

                    {/* 4×4 grid: nums + ops + parens + backspace */}
                    {[
                      ['7','8','9','⌫'],
                      ['4','5','6','+'],
                      ['1','2','3','−'],
                      ['( )','0','.','÷'],
                    ].map(row => (
                      <View key={row.join('')} style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                        {row.map(key => {
                          const isOp = ['+','−','÷'].includes(key);
                          const isBack = key === '⌫';
                          const isParen = key === '( )';
                          return (
                            <Pressable key={key} onPress={() => handleCalcInput(key)}
                              style={({ pressed }) => ({ flex: 1, paddingVertical: 13, borderRadius: 7, borderWidth: 1, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : colors.card, borderColor: pressed ? 'rgba(255,255,255,0.3)' : colors.border })}>
                              <Text style={{ color: isOp ? colors.accent : isBack ? colors.textMuted : isParen ? colors.accent : colors.text, fontSize: isOp ? 20 : 16, fontWeight: isOp || isBack ? '600' : '500' }}>{key}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}

                    {/* OK / Cancel */}
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCalcVisible(false); }}
                        style={({ pressed }) => ({ flex: 1, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
                        <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={applyCalcResult}
                        style={{ flex: 2, paddingVertical: 11, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' }}>
                        <Text style={{ color: '#000', fontWeight: '700' }}>OK</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Date</Text>
                {addDateOpen && (
                  <DateTimePicker
                    value={addDate}
                    mode="date"
                    display="inline"
                    onChange={(_, date) => { if (date) { setAddDate(date); setAddDateOpen(false); } }}
                    maximumDate={new Date()}
                    themeVariant={theme.mode === 'dark' ? 'dark' : 'light'}
                  />
                )}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 6 }}>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const d = new Date(addDate); d.setDate(d.getDate() - 1); setAddDate(d); }}
                    style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>‹</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); Keyboard.dismiss(); setAddDateOpen(prev => !prev); }}
                    style={({ pressed }) => ({ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: addDateOpen ? colors.accent : colors.border, padding: 12, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                  >
                    <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '500' }}>
                      {addDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const d = new Date(addDate); d.setDate(d.getDate() + 1); if (d <= new Date()) setAddDate(d); }}
                    style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>›</Text>
                  </Pressable>
                </View>

                {!addDateOpen && (
                  <>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Notes <Text style={{ color: colors.textMuted, fontWeight: '400' }}>(optional)</Text></Text>
                    <TextInput
                      value={addNotes}
                      onChangeText={setAddNotes}
                      placeholder="e.g. dinner with John"
                      placeholderTextColor={colors.textMuted}
                      style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 14, marginBottom: 20 }}
                    />
                  </>
                )}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAddVisible(false); }} style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
                    <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={submitAdd} style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', opacity: (!addName.trim() || !addAmount) ? 0.4 : 1 }}>
                    <Text style={{ color: '#000', fontWeight: '700' }}>Add</Text>
                  </Pressable>
                </View>
              </View>
              </TouchableWithoutFeedback>

            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Gauge breakdown popover */}
      <Modal transparent visible={gaugePopover} animationType="fade" onRequestClose={() => setGaugePopover(false)}>
        <TouchableWithoutFeedback onPress={() => setGaugePopover(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
            <TouchableWithoutFeedback>
              <View style={{ width: 280, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20 }}>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', marginBottom: 14 }}>This Week</Text>
                {categoryBreakdown.length === 0 ? (
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>No transactions yet</Text>
                ) : (
                  categoryBreakdown.map(([cat, amt]) => {
                    const pct = totalSpent > 0 ? amt / totalSpent : 0;
                    return (
                      <View key={cat} style={{ marginBottom: 10 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={{ color: colors.text, fontSize: 13 }}>{cat}</Text>
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <Text style={{ color: colors.textMuted, fontSize: 13 }}>{Math.round(pct * 100)}%</Text>
                            <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>{formatCurrency(amt)}</Text>
                          </View>
                        </View>
                        <View style={{ height: 3, borderRadius: 2, backgroundColor: colors.gaugeTrack }}>
                          <View style={{ width: `${Math.round(pct * 100)}%`, height: '100%', borderRadius: 2, backgroundColor: colors.accent }} />
                        </View>
                      </View>
                    );
                  })
                )}
                <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 10, flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 13 }}>Total</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{formatCurrency(totalSpent)} <Text style={{ color: colors.textMuted, fontWeight: '400' }}>of {formatCurrency(weeklyBudget)}</Text></Text>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

function DayHeader({ label, daySpent, colors, topBorder }) {
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.border, borderTopWidth: topBorder ? 1 : 0, borderTopColor: colors.border }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</Text>
        {daySpent > 0 && <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{formatCurrency(daySpent)}</Text>}
      </View>
    </View>
  );
}
