import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { formatCurrency, formatDate } from '../utils';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function TransactionRow({ transaction, isExcluded, onPress }) {
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const name = transaction.name || transaction.merchant_name || 'Unknown';
  const isCredit = transaction.amount < 0;
  const amount = (isCredit ? '−' : '') + formatCurrency(transaction.amount);
  const dateStr = formatDate(transaction.date);
  const isPending = transaction.pending;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.6 : isExcluded ? 0.4 : isPending ? 0.7 : 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.background,
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: colors.text,
                textDecorationLine: isExcluded ? 'line-through' : 'none',
              }}
            >
              {name}
            </Text>
            {isPending && (
              <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.gaugeTrack }}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '600' }}>pending</Text>
              </View>
            )}
            {isExcluded && (
              <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.excludedBg }}>
                <Text style={{ fontSize: 10, color: colors.excludedText, fontWeight: '600' }}>excluded</Text>
              </View>
            )}
          </View>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: isCredit ? colors.accent : colors.text,
              textDecorationLine: isExcluded ? 'line-through' : 'none',
            }}
          >
            {amount}
          </Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{dateStr}</Text>
        </View>
      </View>
    </Pressable>
  );
}
