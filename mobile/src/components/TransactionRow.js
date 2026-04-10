import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, TouchableWithoutFeedback } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatCurrency, formatDate } from '../utils';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function TransactionRow({ transaction, isExcluded, onPress, onDelete }) {
  const { theme, overrides, setOverride } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);
  const [modal, setModal] = useState('none'); // 'none' | 'edit'
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());

  const override = overrides[transaction.transaction_id];
  const effectiveAmount = override?.amount ?? transaction.amount;
  const effectiveDate = override?.date ?? transaction.date;

  const name = transaction.name || transaction.merchant_name || 'Unknown';
  const isCredit = effectiveAmount < 0;
  const amount = (isCredit ? '−' : '') + formatCurrency(effectiveAmount);
  const dateStr = formatDate(effectiveDate);
  const isPending = transaction.pending;

  function openEdit() {
    setAmountInput(String(Math.abs(effectiveAmount)));
    setSelectedDate(new Date(effectiveDate + 'T12:00:00'));
    setShowDatePicker(false);
    setModal('edit');
  }

  function saveOverride() {
    const val = parseFloat(amountInput);
    const newAmount = !isNaN(val) && val >= 0
      ? (transaction.amount < 0 ? -val : val)
      : effectiveAmount;
    const d = selectedDate;
    const newDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    setOverride(transaction.transaction_id, newAmount, newDate);
    setModal('none');
    setShowDatePicker(false);
  }

  function clearOverride() {
    setOverride(transaction.transaction_id, null);
    setModal('none');
    setShowDatePicker(false);
  }

  const dateLabel = selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <>
      <Pressable
        onPress={onPress}
        onLongPress={openEdit}
        delayLongPress={400}
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
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text, textDecorationLine: isExcluded ? 'line-through' : 'none' }}>
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
              {override && (
                <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.card }}>
                  <Text style={{ fontSize: 10, color: colors.accent, fontWeight: '600' }}>edited</Text>
                </View>
              )}
              {transaction.offlineQueued && (
                <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.warning + '33' }}>
                  <Text style={{ fontSize: 10, color: colors.warning, fontWeight: '600' }}>queued</Text>
                </View>
              )}
            </View>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: isCredit ? colors.accent : colors.text, textDecorationLine: isExcluded ? 'line-through' : 'none' }}>
              {amount}
            </Text>
            {override?.amount !== undefined && override.amount !== transaction.amount && (
              <Text style={{ fontSize: 11, color: colors.textMuted, textDecorationLine: 'line-through' }}>
                {formatCurrency(transaction.amount)}
              </Text>
            )}
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{dateStr}</Text>
          </View>
        </View>
      </Pressable>

      {/* Edit / Date picker modal */}
      <Modal transparent visible={modal === 'edit'} animationType="fade" onRequestClose={() => { setModal('none'); setShowDatePicker(false); }}>
        <TouchableWithoutFeedback onPress={() => { setModal('none'); setShowDatePicker(false); }}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
            <TouchableWithoutFeedback>
              {transaction.offlineQueued ? (
                /* Simplified modal for queued (offline) transactions — delete only */
                <View style={{ width: 300, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', padding: 24 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>Queued Transaction</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 20 }}>{name} · {formatCurrency(effectiveAmount)}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, textAlign: 'center', marginBottom: 16 }}>
                    Will sync when back online.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => { setModal('none'); onDelete && onDelete(transaction.transaction_id); }} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center' }}>
                      <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
                    </Pressable>
                    <Pressable onPress={() => setModal('none')} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                      <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <View style={{ width: showDatePicker ? undefined : 300, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', padding: 24 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>Edit Transaction</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 16 }}>{name}</Text>

                  <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Amount</Text>
                  <TextInput
                    value={amountInput}
                    onChangeText={setAmountInput}
                    keyboardType="decimal-pad"
                    style={{
                      backgroundColor: colors.background,
                      color: colors.text,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: colors.border,
                      padding: 12,
                      fontSize: 18,
                      fontWeight: '600',
                      marginBottom: 14,
                      textAlign: 'center',
                    }}
                    selectTextOnFocus
                  />

                  <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Date</Text>
                  {showDatePicker && (
                    <DateTimePicker
                      value={selectedDate}
                      mode="date"
                      display="inline"
                      onChange={(_, date) => { if (date) { setSelectedDate(date); setShowDatePicker(false); } }}
                      maximumDate={new Date()}
                      themeVariant={theme.mode === 'dark' ? 'dark' : 'light'}
                    />
                  )}
                  <Pressable
                    onPress={() => setShowDatePicker(prev => !prev)}
                    style={{
                      backgroundColor: colors.background,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: showDatePicker ? colors.accent : colors.border,
                      padding: 12,
                      marginBottom: 20,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '500' }}>{dateLabel}</Text>
                  </Pressable>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {transaction.manual && onDelete ? (
                      <Pressable onPress={() => { setModal('none'); setShowDatePicker(false); onDelete(transaction.transaction_id); }} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center' }}>
                        <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
                      </Pressable>
                    ) : override ? (
                      <Pressable onPress={clearOverride} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center' }}>
                        <Text style={{ color: colors.danger, fontWeight: '600' }}>Reset</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => { setModal('none'); setShowDatePicker(false); }} style={{ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                      <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                    <Pressable onPress={saveOverride} style={{ flex: 1, padding: 12, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' }}>
                      <Text style={{ color: '#000', fontWeight: '700' }}>Save</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </>
  );
}
