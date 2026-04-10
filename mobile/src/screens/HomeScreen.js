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

  // Add transaction modal
  const [addVisible, setAddVisible] = useState(false);
  const [addName, setAddName] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addDate, setAddDate] = useState(new Date());
  const [addDateOpen, setAddDateOpen] = useState(false);

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

  function openAdd() {
    setAddName('');
    setAddAmount('');
    setAddDate(new Date());
    setAddDateOpen(false);
    setAddVisible(true);
  }

  async function submitAdd() {
    const amount = parseFloat(addAmount);
    if (!addName.trim() || !isFinite(amount) || amount <= 0) return;
    const d = addDate;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const txPayload = { name: addName.trim(), amount, date: dateStr };
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
      <CustomHeader />
      <FlatList
        data={[]}
        keyExtractor={() => ''}
        renderItem={null}
        ListHeaderComponent={
          <View>
            <ArcGauge spent={totalSpent} budget={weeklyBudget} accentColor={theme.accentColor} period="week" />

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
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>Today</Text>
                      {todaySpent > 0 && <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{formatCurrency(todaySpent)}</Text>}
                    </View>
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
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, borderTopWidth: showTopBorder ? 1 : 0, borderTopColor: colors.border }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>{formatDateHeader(section.date)}</Text>
                        {daySpent > 0 && <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>{formatCurrency(daySpent)}</Text>}
                      </View>
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
                <Text style={{ fontSize: 12, color: colors.warning }}>
                  {filteredTransactions.filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0).length} transactions
                </Text>
                <Text style={{ fontSize: 12, color: colors.warning }}>{formatCurrency(totalSpent)}</Text>
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
                  {['Food', 'Grocery'].map(label => (
                    <Pressable
                      key={label}
                      onPress={() => setAddName(label)}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: addName === label ? colors.accent : colors.border, backgroundColor: addName === label ? colors.accent + '22' : colors.background }}
                    >
                      <Text style={{ fontSize: 12, color: addName === label ? colors.accent : colors.textMuted, fontWeight: '500' }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Amount</Text>
                <TextInput
                  value={addAmount}
                  onChangeText={setAddAmount}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.textMuted}
                  style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 18, fontWeight: '600', marginBottom: 14, textAlign: 'center' }}
                  selectTextOnFocus
                />

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
                    onPress={() => { const d = new Date(addDate); d.setDate(d.getDate() - 1); setAddDate(d); }}
                    style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>‹</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { Keyboard.dismiss(); setAddDateOpen(prev => !prev); }}
                    style={{ flex: 1, backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: addDateOpen ? colors.accent : colors.border, padding: 12, alignItems: 'center' }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '500' }}>
                      {addDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { const d = new Date(addDate); d.setDate(d.getDate() + 1); if (d <= new Date()) setAddDate(d); }}
                    style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background }}
                  >
                    <Text style={{ color: colors.text, fontSize: 16 }}>›</Text>
                  </Pressable>
                </View>

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => setAddVisible(false)} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
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
    </View>
  );
}
