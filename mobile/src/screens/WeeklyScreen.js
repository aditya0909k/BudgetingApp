import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { formatCurrency, formatWeekLabel } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import InlineProgressBar from '../components/InlineProgressBar';

export default function WeeklyScreen() {
  const navigation = useNavigation();
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchHistory = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/history/weekly`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      setHistory(data.history || []);
    } catch (e) {
      setFetchError(e.message || 'Could not reach server');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchHistory();
    }, [fetchHistory])
  );

  const onRefresh = useCallback(() => fetchHistory(true), [fetchHistory]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader />
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : fetchError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: 16 }}>
            {fetchError}
          </Text>
          <Pressable
            onPress={() => fetchHistory(true)}
            style={{ paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.accent }}
          >
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Retry</Text>
          </Pressable>
        </View>
      ) : history.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Text style={{ color: colors.textMuted, fontSize: 15, textAlign: 'center' }}>
            No weekly history yet. Come back after your first week of tracking.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
        >
          {history.map(entry => {
            const label = formatWeekLabel(entry.startDate, entry.endDate);
            return (
              <Pressable
                key={entry.weekKey}
                onPress={() =>
                  navigation.navigate('WeekDetail', {
                    startDate: entry.startDate,
                    endDate: entry.endDate,
                    label,
                    weekKey: entry.weekKey,
                    weeklyBudget: entry.weeklyBudget,
                  })
                }
                style={({ pressed }) => [
                  {
                    opacity: pressed ? 0.6 : 1,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  },
                ]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 }}>
                    {label}
                  </Text>
                  <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
                    <Text style={{ color: entry.totalSpent > entry.weeklyBudget ? colors.danger : colors.text, fontSize: 15, fontWeight: '600' }}>
                      {formatCurrency(entry.totalSpent)}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                      / {formatCurrency(entry.weeklyBudget)} budget
                    </Text>
                  </View>
                </View>
                <InlineProgressBar spent={entry.totalSpent} budget={entry.weeklyBudget} />
                <Text style={{ fontSize: 12, marginTop: 6, color: entry.totalSpent > entry.weeklyBudget ? colors.danger : colors.accent, fontWeight: '500' }}>
                  {entry.totalSpent > entry.weeklyBudget
                    ? `Over by ${formatCurrency(entry.totalSpent - entry.weeklyBudget)}`
                    : `${formatCurrency(entry.weeklyBudget - entry.totalSpent)} under budget`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
