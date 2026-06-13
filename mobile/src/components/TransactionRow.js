import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput, TouchableWithoutFeedback, KeyboardAvoidingView, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import DateTimePicker from '@react-native-community/datetimepicker';
import { formatCurrency, formatDate } from '../utils';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function TransactionRow({ transaction, isExcluded, onPress, onDelete }) {
  const { theme, overrides, setOverride, pendingOverrideIds } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);
  const [modal, setModal] = useState('none'); // 'none' | 'edit'
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [notesInput, setNotesInput] = useState('');
  const [whoInput, setWhoInput] = useState('me');
  const [nameInput, setNameInput] = useState('');

  const override = overrides[transaction.transaction_id];
  const effectiveAmount = override?.amount ?? transaction.amount;
  const effectiveDate = override?.date ?? transaction.date;
  const effectiveNotes = (override && 'notes' in override) ? (override.notes ?? '') : (transaction.notes ?? '');
  const isPendingOverride = pendingOverrideIds?.has(transaction.transaction_id);

  const name = override?.name ?? transaction.name ?? transaction.merchant_name ?? 'Unknown';
  const isCredit = effectiveAmount < 0;
  const amount = (isCredit ? '−' : '') + formatCurrency(effectiveAmount);
  const dateStr = formatDate(effectiveDate);
  const isPending = transaction.pending;

  function openEdit() {
    setAmountInput(String(Math.abs(effectiveAmount)));
    setSelectedDate(new Date(effectiveDate + 'T12:00:00'));
    setNotesInput(effectiveNotes);
    setWhoInput(override?.who ?? transaction.who ?? 'me');
    setNameInput(name);
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
    const originalName = transaction.name ?? transaction.merchant_name ?? 'Unknown';
    const newName = nameInput.trim() !== originalName ? (nameInput.trim() || null) : undefined;
    setOverride(transaction.transaction_id, newAmount, newDate, notesInput.trim(), whoInput, newName);
    setModal('none');
    setShowDatePicker(false);
  }

  function clearOverride() {
    setOverride(transaction.transaction_id, null, undefined, notesInput.trim(), whoInput, undefined);
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
              {(transaction.offlineQueued || isPendingOverride) && (
                <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: colors.warning + '33' }}>
                  <Text style={{ fontSize: 10, color: colors.warning, fontWeight: '600' }}>queued</Text>
                </View>
              )}
            </View>
            {effectiveNotes ? (
              <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>{effectiveNotes}</Text>
            ) : null}
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
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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

                  {!showDatePicker && (
                    <>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Name</Text>
                      <TextInput
                        value={nameInput}
                        onChangeText={setNameInput}
                        placeholder="Transaction name"
                        placeholderTextColor={colors.textMuted}
                        style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 14, marginBottom: 8 }}
                      />
                      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 14 }}>
                        {['Food', 'Grocery', 'Misc'].map(label => (
                          <Pressable
                            key={label}
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setNameInput(label); }}
                            style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: nameInput === label ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : nameInput === label ? colors.accent + '22' : colors.background })}
                          >
                            <Text style={{ fontSize: 12, color: nameInput === label ? colors.accent : colors.textMuted, fontWeight: '500' }}>{label}</Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Amount</Text>
                      <TextInput
                        value={amountInput}
                        onChangeText={setAmountInput}
                        keyboardType="decimal-pad"
                        style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 14 }}
                        selectTextOnFocus
                      />

                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>Notes</Text>
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          {[['me', 'Me'], ['both', 'Both'], ['others', 'Others']].map(([val, label]) => (
                            <Pressable
                              key={val}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWhoInput(val); }}
                              style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: whoInput === val ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : whoInput === val ? colors.accent + '22' : 'transparent' })}
                            >
                              <Text style={{ fontSize: 11, color: whoInput === val ? colors.accent : colors.textMuted, fontWeight: '600' }}>{label}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                      <TextInput
                        value={notesInput}
                        onChangeText={setNotesInput}
                        placeholder="Optional note"
                        placeholderTextColor={colors.textMuted}
                        style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 14, marginBottom: 14 }}
                      />
                    </>
                  )}

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
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 6 }}>
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d); }}
                      style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                    >
                      <Text style={{ color: colors.text, fontSize: 16 }}>‹</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowDatePicker(prev => !prev); }}
                      style={({ pressed }) => ({ flex: 1, borderRadius: 8, borderWidth: 1, borderColor: showDatePicker ? colors.accent : colors.border, padding: 12, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                    >
                      <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '500' }}>{dateLabel}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const d = new Date(selectedDate); d.setDate(d.getDate() + 1); if (d <= new Date()) setSelectedDate(d); }}
                      style={({ pressed }) => ({ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background })}
                    >
                      <Text style={{ color: colors.text, fontSize: 16 }}>›</Text>
                    </Pressable>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {transaction.manual && onDelete ? (
                      <Pressable onPress={() => { setModal('none'); setShowDatePicker(false); onDelete(transaction.transaction_id); }} style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent' })}>
                        <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete</Text>
                      </Pressable>
                    ) : override ? (
                      <Pressable onPress={clearOverride} style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent' })}>
                        <Text style={{ color: colors.danger, fontWeight: '600' }}>Reset</Text>
                      </Pressable>
                    ) : null}
                    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setModal('none'); setShowDatePicker(false); }} style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
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
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
