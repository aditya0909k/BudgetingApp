import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TouchableWithoutFeedback,
  ScrollView,
} from 'react-native';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function AccountFilterDropdown({ accounts, selectedAccountIds, onChange }) {
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);
  const [visible, setVisible] = useState(false);

  const allSelected = accounts.length > 0 && (selectedAccountIds === null || selectedAccountIds.size === accounts.length);

  function triggerLabel() {
    if (allSelected || !selectedAccountIds || selectedAccountIds.size === 0) return 'All Accounts ˅';
    return `${selectedAccountIds.size} account${selectedAccountIds.size > 1 ? 's' : ''} ˅`;
  }

  function toggleAll() {
    if (allSelected) {
      onChange(new Set());
    } else {
      onChange(new Set(accounts.map(a => a.accountId)));
    }
  }

  function toggleAccount(accountId) {
    const next = new Set(selectedAccountIds || accounts.map(a => a.accountId));
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    onChange(next);
  }

  return (
    <View style={{ marginHorizontal: 16, marginVertical: 8 }}>
      <Pressable
        onPress={() => setVisible(true)}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          alignSelf: 'flex-start',
        }}
      >
        <Text style={{ color: colors.text, fontSize: 14, fontWeight: '500' }}>
          {triggerLabel()}
        </Text>
      </Pressable>

      <Modal
        transparent
        visible={visible}
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setVisible(false)}>
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.5)',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <TouchableWithoutFeedback>
              <View
                style={{
                  width: 320,
                  maxHeight: 420,
                  backgroundColor: colors.card,
                  borderRadius: 14,
                  overflow: 'hidden',
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                {/* Header */}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
                    Filter Accounts
                  </Text>
                  <Pressable onPress={() => setVisible(false)}>
                    <Text style={{ color: colors.accent, fontSize: 15, fontWeight: '600' }}>
                      Done
                    </Text>
                  </Pressable>
                </View>

                <ScrollView>
                  {/* All row */}
                  <Pressable
                    onPress={toggleAll}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Checkbox checked={allSelected} colors={colors} />
                    <Text style={{ color: colors.text, fontSize: 15, marginLeft: 12, fontWeight: '500' }}>
                      All
                    </Text>
                  </Pressable>

                  {accounts.map(acct => {
                    const checked = selectedAccountIds === null || selectedAccountIds.has(acct.accountId);
                    return (
                      <Pressable
                        key={acct.accountId}
                        onPress={() => toggleAccount(acct.accountId)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 16,
                          paddingVertical: 14,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <Checkbox checked={checked} colors={colors} />
                        <Text
                          style={{ color: colors.text, fontSize: 14, marginLeft: 12, flex: 1 }}
                          numberOfLines={1}
                        >
                          {acct.institutionName} – {acct.name}
                          {acct.mask ? ` ••${acct.mask}` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

function Checkbox({ checked, colors }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: checked ? colors.accent : colors.textMuted,
        backgroundColor: checked ? colors.accent : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked && (
        <Text style={{ color: '#000', fontSize: 13, fontWeight: '700', lineHeight: 16 }}>✓</Text>
      )}
    </View>
  );
}
