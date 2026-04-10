import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { shiftDate, formatDateHeader, formatCurrency } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import ArcGauge from '../components/ArcGauge';
import TransactionRow from '../components/TransactionRow';
import AccountFilterDropdown from '../components/AccountFilterDropdown';

export default function MonthDetailScreen() {
  const route = useRoute();
  const { startDate, endDate, label, monthKey } = route.params;
  const { weeklyBudget, excludedIds, toggleExcluded, overrides, theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const daysInMonth = (() => { const [y, m] = startDate.split('-').map(Number); return new Date(y, m, 0).getDate(); })();
  const monthlyBudget = parseFloat((weeklyBudget * daysInMonth / 7).toFixed(2));

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
      const fetchStart = shiftDate(startDate, -7);
      const fetchEnd = shiftDate(endDate, 7);
      const res = await fetch(
        `${API_BASE_URL}/api/transactions?startDate=${fetchStart}&endDate=${fetchEnd}${isRefresh ? '&force=true' : ''}`
      );
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const txns = data.transactions || [];
      const accts = data.accounts || [];
      setTransactions(txns);
      setAccounts(accts);
      setSelectedAccountIds(prev => {
        const incoming = new Set(accts.map(a => a.accountId));
        if (prev === null) return incoming;
        const next = new Set(prev);
        for (const id of incoming) next.add(id);
        return next;
      });
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

  // Keep history record in sync with current exclusions
  const totalSpentAllAccounts = useMemo(
    () => transactions
      .filter(t => {
        if (excludedIds.has(t.transaction_id) || t.amount <= 0) return false;
        const effectiveDate = overrides[t.transaction_id]?.date ?? t.date;
        return effectiveDate >= startDate && effectiveDate <= endDate;
      })
      .reduce((s, t) => s + (overrides[t.transaction_id]?.amount ?? t.amount), 0),
    [transactions, excludedIds, overrides, startDate, endDate]
  );
  React.useEffect(() => {
    if (!loading && transactions.length > 0 && monthKey) {
      fetch(`${API_BASE_URL}/api/history/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'monthly', key: monthKey, totalSpent: totalSpentAllAccounts, startDate, endDate, label }),
      }).catch(() => {});
    }
  }, [totalSpentAllAccounts, loading, monthKey]);

  const sections = useMemo(() => {
    const groups = {};
    for (const t of filteredTransactions) {
      const d = overrides[t.transaction_id]?.date ?? t.date;
      if (!groups[d]) groups[d] = [];
      groups[d].push(t);
    }
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map(date => ({ date, transactions: groups[date] }));
  }, [filteredTransactions, overrides]);

  async function handleDelete(transactionId) {
    try {
      await fetch(`${API_BASE_URL}/api/transactions/${transactionId}`, { method: 'DELETE' });
      fetchData();
    } catch (e) {}
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
          data={[]}
          keyExtractor={() => ''}
          renderItem={null}
          ListHeaderComponent={
            <View>
              <ArcGauge spent={totalSpent} budget={monthlyBudget} accentColor={theme.accentColor} period="month" />
              {!(accounts.length === 0 || accounts.every(a => a.accountId === 'manual')) && (
                <AccountFilterDropdown
                  accounts={accounts}
                  selectedAccountIds={selectedAccountIds}
                  onChange={setSelectedAccountIds}
                />
              )}

              {/* Single continuous card */}
              {sections.length > 0 && (
                <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginHorizontal: 16, marginTop: 8, overflow: 'hidden' }}>
                  {sections.map((section, idx) => {
                    const daySpent = section.transactions
                      .filter(t => !excludedIds.has(t.transaction_id) && (overrides[t.transaction_id]?.amount ?? t.amount) > 0)
                      .reduce((s, t) => s + (overrides[t.transaction_id]?.amount ?? t.amount), 0);
                    return (
                      <React.Fragment key={section.date}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: colors.border }}>
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

              {/* Empty / error */}
              {sections.length === 0 && (
                <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 24 }}>
                  {fetchError ? (
                    <>
                      <Text style={{ color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>{fetchError}</Text>
                      <Pressable onPress={() => fetchData(true)} style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent }}>
                        <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
                      </Pressable>
                    </>
                  ) : (
                    <Text style={{ color: colors.textMuted, fontSize: 15 }}>No transactions this month</Text>
                  )}
                </View>
              )}

              {/* Footer */}
              {filteredTransactions.length > 0 && (
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
          contentContainerStyle={{ paddingBottom: 40 }}
        />
      )}
    </View>
  );
}
