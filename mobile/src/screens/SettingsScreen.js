import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { formatCurrency } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';

function hexToRgb(hex) {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return null;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

function SectionTitle({ label, colors }) {
  return (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '700',
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: 0.8,
        marginTop: 28,
        marginBottom: 8,
        marginHorizontal: 16,
      }}
    >
      {label}
    </Text>
  );
}

function Card({ children, colors }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        marginHorizontal: 16,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function RowSeparator({ colors }) {
  return <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 16 }} />;
}

export default function SettingsScreen() {
  const { weeklyBudget, setWeeklyBudget, linkedAccounts, refreshAccounts, theme, setTheme } =
    useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  // ─── Budget ──────────────────────────────────────────────────────────────────
  const [budgetInput, setBudgetInput] = useState(String(weeklyBudget));
  const [budgetSaved, setBudgetSaved] = useState(false);

  async function saveBudget() {
    const val = parseFloat(budgetInput);
    if (!val || val <= 0) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/budget`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeklyBudget: val }),
      });
      const data = await res.json();
      if (data.success) {
        setWeeklyBudget(data.weeklyBudget);
        setBudgetSaved(true);
        setTimeout(() => setBudgetSaved(false), 2000);
      } else {
        Alert.alert('Error', data.error || 'Failed to save budget.');
      }
    } catch (e) {
      Alert.alert('Server Error', `Could not reach server.\n\n${e.message}`);
    }
  }

  // ─── Accent color ─────────────────────────────────────────────────────────────
  const initRgb = hexToRgb(theme.accentColor) || { r: 74, g: 222, b: 128 };
  const [r, setR] = useState(initRgb.r);
  const [g, setG] = useState(initRgb.g);
  const [b, setB] = useState(initRgb.b);
  const [hexInput, setHexInput] = useState(theme.accentColor);
  const debounceRef = useRef(null);

  function onSliderChange(channel, value) {
    const val = Math.round(value);
    let nr = r, ng = g, nb = b;
    if (channel === 'r') { setR(val); nr = val; }
    if (channel === 'g') { setG(val); ng = val; }
    if (channel === 'b') { setB(val); nb = val; }
    const hex = rgbToHex(nr, ng, nb);
    setHexInput(hex);
    scheduleAccentSave(hex);
  }

  function onHexChange(text) {
    setHexInput(text);
    const clean = text.startsWith('#') ? text : '#' + text;
    const rgb = hexToRgb(clean);
    if (rgb) {
      setR(rgb.r);
      setG(rgb.g);
      setB(rgb.b);
      scheduleAccentSave(clean);
    }
  }

  function scheduleAccentSave(hex) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTheme({ accentColor: hex });
    }, 300);
  }

  // ─── Teller Connect (opens server /link page in browser) ─────────────────────
  async function startAddAccount() {
    try {
      // Opens an in-app browser (SFSafariViewController on iOS).
      // The /link page runs Teller Connect and posts the enrollment to the server.
      // When the user closes the browser we refresh the account list.
      await WebBrowser.openBrowserAsync(`${API_BASE_URL}/link`);
      await refreshAccounts();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not open link page.');
    }
  }

  async function removeAccount(itemId, institutionName) {
    Alert.alert(
      'Remove Account',
      `Remove ${institutionName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE_URL}/api/accounts/${itemId}`, { method: 'DELETE' });
              await refreshAccounts();
            } catch (e) {
              Alert.alert('Error', 'Failed to remove account.');
            }
          },
        },
      ]
    );
  }

  // Deduplicate items (multiple accounts per item)
  const itemIds = [...new Set(linkedAccounts.map(a => a.itemId))];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* ── Budget ── */}
        <SectionTitle label="Budget" colors={colors} />
        <Card colors={colors}>
          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
              Weekly Budget
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TextInput
                value={budgetInput}
                onChangeText={setBudgetInput}
                keyboardType="decimal-pad"
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 12,
                  color: colors.text,
                  backgroundColor: colors.background,
                  fontSize: 16,
                }}
                placeholderTextColor={colors.textMuted}
              />
              <Pressable
                onPress={saveBudget}
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 11,
                  borderRadius: 8,
                  backgroundColor: colors.accent,
                }}
              >
                <Text style={{ color: '#000', fontWeight: '700', fontSize: 14 }}>Save</Text>
              </Pressable>
            </View>
            {budgetSaved && (
              <Text style={{ color: colors.success, marginTop: 8, fontSize: 13 }}>Saved!</Text>
            )}
          </View>
        </Card>

        {/* ── Appearance ── */}
        <SectionTitle label="Appearance" colors={colors} />
        <Card colors={colors}>
          {/* Theme toggle */}
          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 10 }}>Theme</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {['light', 'dark'].map(mode => {
                const active = theme.mode === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => setTheme({ mode })}
                    style={{
                      paddingHorizontal: 24,
                      paddingVertical: 9,
                      borderRadius: 20,
                      borderWidth: 2,
                      borderColor: active ? colors.accent : colors.border,
                      backgroundColor: active ? colors.accent : 'transparent',
                    }}
                  >
                    <Text
                      style={{
                        color: active ? '#000' : colors.text,
                        fontWeight: '600',
                        textTransform: 'capitalize',
                      }}
                    >
                      {mode}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <RowSeparator colors={colors} />

          {/* Accent color picker */}
          <View style={{ padding: 16 }}>
            <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 12 }}>
              Accent Color
            </Text>

            {/* Preset chips */}
            {(() => {
              const PRESETS = ['#4ade80', '#60a5fa', '#a78bfa', '#fb923c', '#f472b6', '#facc15'];
              return (
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  {PRESETS.map(hex => (
                    <Pressable
                      key={hex}
                      onPress={() => { setHexInput(hex); const rgb = hexToRgb(hex); if (rgb) { setR(rgb.r); setG(rgb.g); setB(rgb.b); } scheduleAccentSave(hex); }}
                      style={{
                        width: 30, height: 30, borderRadius: 15,
                        backgroundColor: hex,
                        borderWidth: theme.accentColor === hex ? 3 : 1.5,
                        borderColor: theme.accentColor === hex ? '#fff' : 'transparent',
                      }}
                    />
                  ))}
                </View>
              );
            })()}

            {/* Swatch */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: hexInput.startsWith('#') && hexToRgb(hexInput) ? hexInput : colors.accent,
                  borderWidth: 2,
                  borderColor: colors.border,
                }}
              />
              <TextInput
                value={hexInput}
                onChangeText={onHexChange}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={7}
                style={{
                  width: 100,
                  height: 36,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: colors.border,
                  paddingHorizontal: 10,
                  color: colors.text,
                  backgroundColor: colors.background,
                  fontSize: 14,
                  fontFamily: 'monospace',
                }}
              />
            </View>

            {/* R slider */}
            <ColorSliderRow label="R" value={r} color="#f87171" onChange={v => onSliderChange('r', v)} colors={colors} />
            <ColorSliderRow label="G" value={g} color="#4ade80" onChange={v => onSliderChange('g', v)} colors={colors} />
            <ColorSliderRow label="B" value={b} color="#60a5fa" onChange={v => onSliderChange('b', v)} colors={colors} />
          </View>
        </Card>

        {/* ── Linked Accounts ── */}
        <SectionTitle label="Linked Accounts" colors={colors} />
        <Card colors={colors}>
          {linkedAccounts.length === 0 ? (
            <View style={{ padding: 16 }}>
              <Text style={{ color: colors.textMuted, fontSize: 14 }}>No accounts linked yet.</Text>
            </View>
          ) : (
            itemIds.map((itemId, idx) => {
              const accts = linkedAccounts.filter(a => a.itemId === itemId);
              const institutionName = accts[0]?.institutionName || 'Bank';
              return (
                <View key={itemId}>
                  {idx > 0 && <RowSeparator colors={colors} />}
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>
                        {institutionName}
                      </Text>
                      {accts.map(a => (
                        <Text key={a.accountId} style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                          {a.name}{a.mask ? ` ••${a.mask}` : ''}
                        </Text>
                      ))}
                    </View>
                    <Pressable
                      onPress={() => removeAccount(itemId, institutionName)}
                      style={{
                        paddingHorizontal: 14,
                        paddingVertical: 7,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: colors.danger,
                      }}
                    >
                      <Text style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
                        Remove
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}

          {linkedAccounts.length > 0 && <RowSeparator colors={colors} />}

          {/* Add Account button */}
          <Pressable
            onPress={startAddAccount}
            style={({ pressed }) => [
              {
                margin: 16,
                paddingVertical: 13,
                borderRadius: 10,
                backgroundColor: colors.accent,
                alignItems: 'center',
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <Text style={{ color: '#000', fontWeight: '700', fontSize: 15 }}>+ Add Account</Text>
          </Pressable>
        </Card>
      </ScrollView>

    </View>
  );
}

// Simple touch-based "slider" using a pressable track
function ColorSliderRow({ label, value, color, onChange, colors }) {
  const trackWidth = 240;

  function handlePress(e) {
    const x = e.nativeEvent.locationX;
    const pct = Math.max(0, Math.min(1, x / trackWidth));
    onChange(Math.round(pct * 255));
  }

  const pct = value / 255;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 }}>
      <Text style={{ color: colors.textMuted, fontSize: 13, width: 14 }}>{label}</Text>
      <Pressable onPress={handlePress} style={{ width: trackWidth, height: 20, justifyContent: 'center' }}>
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.gaugeTrack,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              width: `${Math.round(pct * 100)}%`,
              height: '100%',
              backgroundColor: color,
              borderRadius: 3,
            }}
          />
        </View>
        {/* Thumb */}
        <View
          style={{
            position: 'absolute',
            left: pct * (trackWidth - 18),
            width: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: '#fff',
            borderWidth: 2,
            borderColor: color,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 3,
            shadowOffset: { width: 0, height: 1 },
          }}
        />
      </Pressable>
      <Text style={{ color: colors.text, fontSize: 13, width: 28, textAlign: 'right' }}>
        {value}
      </Text>
    </View>
  );
}
