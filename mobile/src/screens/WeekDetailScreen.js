import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import ArcGauge from '../components/ArcGauge';
import TransactionRow from '../components/TransactionRow';
import AccountFilterDropdown from '../components/AccountFilterDropdown';

export default function WeekDetailScreen() {
  const route = useRoute();
  const { startDate, endDate, label, weekKey } = route.params;
  const { weeklyBudget, excludedIds, toggleExcluded, theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [transactions, setTransactions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);
    try {
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
      setSelectedAccountIds(prev =>
        prev === null ? new Set(accts.map(a => a.accountId)) : prev
      );
    } catch (e) {
      setFetchError(e.message || 'Could not reach server');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [startDate, endDate]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { fetchData(); }, [startDate, endDate]);

  const onRefresh = useCallback(() => fetchData(true), [fetchData]);

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

  // Keep history record in sync with current exclusions
  const totalSpentAllAccounts = useMemo(
    () => transactions.filter(t => !excludedIds.has(t.transaction_id) && t.amount > 0).reduce((s, t) => s + t.amount, 0),
    [transactions, excludedIds]
  );
  React.useEffect(() => {
    if (!loading && transactions.length > 0 && weekKey) {
      fetch(`${API_BASE_URL}/api/history/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'weekly', key: weekKey, totalSpent: totalSpentAllAccounts }),
      }).catch(() => {});
    }
  }, [totalSpentAllAccounts, loading, weekKey]);

  function renderItem({ item }) {
    return (
      <TransactionRow
        transaction={item}
        isExcluded={excludedIds.has(item.transaction_id)}
        onPress={() => toggleExcluded(item.transaction_id)}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader title={label} />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={filteredTransactions}
          keyExtractor={item => item.transaction_id}
          renderItem={renderItem}
          ListHeaderComponent={
            <View>
              <ArcGauge spent={totalSpent} budget={weeklyBudget} accentColor={theme.accentColor} period="week" />
              <AccountFilterDropdown
                accounts={accounts}
                selectedAccountIds={selectedAccountIds}
                onChange={setSelectedAccountIds}
              />
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
              {fetchError ? (
                <>
                  <Text style={{ color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
                    {fetchError}
                  </Text>
                  <Pressable
                    onPress={() => fetchData(true)}
                    style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent }}
                  >
                    <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={{ color: colors.textMuted, fontSize: 15 }}>No transactions this week</Text>
              )}
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}
