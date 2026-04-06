import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { getCurrentWeekRange, getTodayStr, formatCurrency } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import ArcGauge from '../components/ArcGauge';
import TransactionRow from '../components/TransactionRow';
import AccountFilterDropdown from '../components/AccountFilterDropdown';
import SkeletonRow from '../components/SkeletonRow';

export default function HomeScreen() {
  const { weeklyBudget, excludedIds, toggleExcluded, theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [enrollmentErrors, setEnrollmentErrors] = useState([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
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
      setSelectedAccountIds(prev =>
        prev === null ? new Set(accts.map(a => a.accountId)) : prev
      );
      setLastRefreshed(new Date());
    } catch (e) {
      setFetchError(e.message || 'Could not reach server');
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
    if (!selectedAccountIds) return transactions;
    if (selectedAccountIds.size === 0) return [];
    if (selectedAccountIds.size === accounts.length) return transactions;
    return transactions.filter(t => selectedAccountIds.has(t.account_id));
  }, [transactions, selectedAccountIds, accounts]);

  const totalSpent = useMemo(
    () =>
      filteredTransactions
        .filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0)
        .reduce((s, t) => s + t.amount, 0),
    [filteredTransactions, excludedIds]
  );


  // Split transactions: today vs older
  const todayStr = getTodayStr();
  const todayTxns = useMemo(
    () => filteredTransactions.filter(t => t.date === todayStr),
    [filteredTransactions, todayStr]
  );
  const todaySpent = useMemo(
    () => todayTxns.filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [todayTxns, excludedIds]
  );
  const olderTxns = useMemo(
    () => filteredTransactions.filter(t => t.date !== todayStr),
    [filteredTransactions, todayStr]
  );

  function refreshedLabel() {
    if (!lastRefreshed) return null;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mon = months[lastRefreshed.getMonth()];
    const day = lastRefreshed.getDate();
    const h = lastRefreshed.getHours();
    const m = String(lastRefreshed.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `Updated ${mon} ${day}, ${h12}:${m} ${ampm}`;
  }

  function renderItem({ item }) {
    return (
      <TransactionRow
        transaction={item}
        isExcluded={excludedIds.has(item.transaction_id)}
        onPress={() => toggleExcluded(item.transaction_id)}
      />
    );
  }

  function renderEmpty() {
    if (loading) return null;
    if (fetchError) {
      return (
        <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
          <Text style={{ color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {fetchError}
          </Text>
          <Pressable
            onPress={() => fetchData(true)}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent }}
          >
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (enrollmentErrors.length > 0) {
      return (
        <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
          <Text style={{ color: colors.warning, fontSize: 15, fontWeight: '600', marginBottom: 8 }}>
            Bank reconnection required
          </Text>
          {enrollmentErrors.map(e => (
            <Text key={e.enrollmentId} style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 4 }}>
              {e.institutionName}: {e.error.includes('mfa') ? 'MFA required — re-link in Settings' : e.error}
            </Text>
          ))}
        </View>
      );
    }
    if (todayTxns.length === 0 && olderTxns.length === 0) {
      return (
        <View style={{ alignItems: 'center', marginTop: 40 }}>
          <Text style={{ color: colors.textMuted, fontSize: 15 }}>No transactions this week</Text>
        </View>
      );
    }
    return null;
  }

  const refreshedStr = refreshedLabel();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader />
      <FlatList
        data={loading ? [] : olderTxns}
        keyExtractor={item => item.transaction_id}
        renderItem={renderItem}
        ListHeaderComponent={
          <View>
            <ArcGauge spent={totalSpent} budget={weeklyBudget} accentColor={theme.accentColor} period="week" />


            {/* Account filter + last refreshed */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 }}>
              <AccountFilterDropdown
                accounts={accounts}
                selectedAccountIds={selectedAccountIds}
                onChange={setSelectedAccountIds}
              />
              {refreshedStr && (
                <Text style={{ fontSize: 11, color: colors.textMuted }}>{refreshedStr}</Text>
              )}
            </View>

            {/* Today card */}
            {!loading && todayTxns.length > 0 && (
              <View style={{
                backgroundColor: colors.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                marginHorizontal: 16,
                marginTop: 8,
                marginBottom: 4,
                overflow: 'hidden',
              }}>
                <View style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    Today
                  </Text>
                  {todaySpent > 0 && (
                    <Text style={{ fontSize: 13, fontWeight: '600', color: colors.text }}>
                      {formatCurrency(todaySpent)}
                    </Text>
                  )}
                </View>
                {todayTxns.map(item => (
                  <TransactionRow
                    key={item.transaction_id}
                    transaction={item}
                    isExcluded={excludedIds.has(item.transaction_id)}
                    onPress={() => toggleExcluded(item.transaction_id)}
                  />
                ))}
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
          </View>
        }
        ListEmptyComponent={renderEmpty()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
      />
    </View>
  );
}
