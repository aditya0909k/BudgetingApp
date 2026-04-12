import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAppContext } from '../context/AppContext';
import { getTheme } from '../theme';
import { API_BASE_URL } from '../config';

function calcEval(expr) {
  const s = expr.replace(/\s/g, '');
  let pos = 0;
  function parseExpr() {
    let v = parseTerm();
    while (pos < s.length && (s[pos] === '+' || s[pos] === '-')) {
      const op = s[pos++]; const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (pos < s.length && (s[pos] === '*' || s[pos] === '/')) {
      const op = s[pos++]; const r = parseFactor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (s[pos] === '(') { pos++; const v = parseExpr(); if (s[pos] === ')') pos++; return v; }
    if (s[pos] === '-') { pos++; return -parseFactor(); }
    let n = '';
    while (pos < s.length && (s[pos] >= '0' && s[pos] <= '9' || s[pos] === '.')) n += s[pos++];
    return parseFloat(n) || 0;
  }
  try { const r = parseExpr(); return isFinite(r) ? Math.round(r * 100) / 100 : null; } catch { return null; }
}

const NAV_ITEMS = [
  { label: 'Home', screen: 'Home' },
  { label: 'Weekly Spending', screen: 'Weekly' },
  { label: 'Monthly Spending', screen: 'Monthly' },
];

const SCREEN_LABELS = {
  Home: 'Home',
  Weekly: 'Weekly Spending',
  Monthly: 'Monthly Spending',
  WeekDetail: null,
  MonthDetail: null,
  Settings: 'Settings',
};

const TIP_PRESETS = [10, 15, 20, 25];

export default function CustomHeader({ title, onTransactionAdded }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });
  const centerRef = useRef(null);

  // Tip calculator state
  const [tipVisible, setTipVisible] = useState(false);
  const [bill, setBill] = useState('');
  const [selectedTip, setSelectedTip] = useState(18);
  const [customTip, setCustomTip] = useState('');
  const [split, setSplit] = useState(1);
  const [calcVisible, setCalcVisible] = useState(false);
  const [calcExpr, setCalcExpr] = useState('');

  const tipPct = customTip !== '' ? (parseFloat(customTip) || 0) : selectedTip;
  const billNum = parseFloat(bill) || 0;
  const tipAmt = Math.round(billNum * tipPct) / 100;
  const total = billNum + tipAmt;
  const perPerson = split > 1 ? total / split : null;

  const calcResult = React.useMemo(() => calcEval(calcExpr), [calcExpr]);
  const OPS = new Set(['+', '-', '*', '/']);
  const OP_MAP = { '−': '-', '÷': '/', '( )': '()' };

  function openTip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBill('');
    setSelectedTip(18);
    setCustomTip('');
    setSplit(1);
    setCalcVisible(false);
    setCalcExpr('');
    setTipVisible(true);
  }

  function openCalc() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCalcExpr(bill || '');
    setCalcVisible(true);
  }

  function handleCalcInput(key) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (key === '⌫') { setCalcExpr(p => p.slice(0, -1)); return; }
    const char = OP_MAP[key] ?? key;
    if (char === '()') {
      setCalcExpr(p => {
        const open = (p.match(/\(/g) || []).length;
        const close = (p.match(/\)/g) || []).length;
        const unclosed = open - close;
        const last = p.slice(-1);
        return p + (unclosed > 0 && /[\d.)]/.test(last) ? ')' : '(');
      });
      return;
    }
    if (OPS.has(char)) {
      setCalcExpr(p => OPS.has(p.slice(-1)) ? p.slice(0, -1) + char : p + char);
      return;
    }
    if (key === '.') {
      setCalcExpr(p => {
        const lastNum = p.split(/[+\-*/()]/).pop();
        return lastNum.includes('.') ? p : p + '.';
      });
      return;
    }
    setCalcExpr(p => p + char);
  }

  function applyCalcResult() {
    const val = calcResult !== null ? calcResult : parseFloat(calcExpr) || 0;
    setBill(val % 1 === 0 ? String(val) : val.toFixed(2));
    setCalcVisible(false);
  }

  function pickPreset(pct) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTip(pct);
    setCustomTip('');
  }

  const screenLabel = title || SCREEN_LABELS[route.name] || route.name;

  function openDropdown() {
    centerRef.current?.measure((fx, fy, width, height, px, py) => {
      setDropdownPos({ top: py + height, left: px, width });
      setDropdownVisible(true);
    });
  }

  function navigateTo(screen) {
    setDropdownVisible(false);
    if (route.name === screen) return;
    navigation.navigate(screen);
  }

  const fmt = (n) => `$${n.toFixed(2)}`;

  async function addTipTransaction() {
    if (total <= 0) return;
    const amount = Math.round((perPerson ?? total) * 100) / 100;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    setTipVisible(false);
    try {
      await fetch(`${API_BASE_URL}/api/transactions/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Food', amount, date: dateStr }),
      });
      onTransactionAdded?.();
    } catch {}
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={styles.inner}>
        {/* Left — tip calculator */}
        <View style={[styles.side, { alignItems: 'flex-start' }]}>
          <Pressable onPress={openTip} style={styles.gearBtn}>
            <Text style={[styles.gear, { color: colors.accent }]}>%</Text>
          </Pressable>
        </View>

        {/* Center — tappable dropdown */}
        <Pressable ref={centerRef} onPress={openDropdown} style={styles.center} android_ripple={{ color: colors.border }}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{screenLabel}</Text>
          {(route.name === 'WeekDetail' || route.name === 'MonthDetail') && (
            <Text style={[styles.chevron, { color: colors.textMuted }]}> ˅</Text>
          )}
        </Pressable>

        {/* Right — settings gear */}
        <View style={styles.side}>
          <Pressable onPress={() => navigation.navigate('Settings')} style={styles.gearBtn}>
            <Text style={[styles.gear, { color: colors.textMuted }]}>⚙</Text>
          </Pressable>
        </View>
      </View>

      {/* Navigation Dropdown Modal */}
      <Modal transparent visible={dropdownVisible} animationType="fade" onRequestClose={() => setDropdownVisible(false)}>
        <TouchableWithoutFeedback onPress={() => setDropdownVisible(false)}>
          <View style={StyleSheet.absoluteFill}>
            <TouchableWithoutFeedback>
              <View style={[styles.dropdown, { top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width, backgroundColor: colors.card, borderColor: colors.border }]}>
                {NAV_ITEMS.map(item => {
                  const isActive = route.name === item.screen;
                  return (
                    <TouchableOpacity key={item.screen} onPress={() => navigateTo(item.screen)}
                      style={[styles.dropdownItem, isActive && { backgroundColor: colors.accent + '22' }]}>
                      <Text style={[styles.dropdownText, { color: isActive ? colors.accent : colors.text }]}>{item.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Tip Calculator Modal */}
      <Modal transparent visible={tipVisible} animationType="fade" onRequestClose={() => setTipVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <TouchableWithoutFeedback onPress={() => setTipVisible(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
              <TouchableWithoutFeedback>
                <View style={{ width: 300, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 20 }}>
                  <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 16 }}>Tip Calculator</Text>

                  {/* Bill input */}
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 6 }}>Bill Amount</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: calcVisible ? 10 : 16 }}>
                    <TextInput
                      value={bill}
                      onChangeText={setBill}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.textMuted}
                      style={{ flex: 1, backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 12, fontSize: 22, fontWeight: '700', textAlign: 'center' }}
                      selectTextOnFocus
                    />
                    <Pressable
                      onPress={openCalc}
                      style={({ pressed }) => ({ width: 48, borderRadius: 8, borderWidth: 1, borderColor: calcVisible ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background, alignItems: 'center', justifyContent: 'center' })}
                    >
                      <Text style={{ fontSize: 20, color: colors.textMuted }}>±</Text>
                    </Pressable>
                  </View>

                  {/* Calculator panel */}
                  {calcVisible && (
                    <View style={{ backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 16 }}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right', marginBottom: 8, minHeight: 22 }}>
                        {(calcExpr || '0').replace(/\*/g, '×').replace(/\//g, '÷')}
                        {calcResult !== null && calcExpr ? ` = ${calcResult}` : ''}
                      </Text>
                      {[['7','8','9','⌫'],['4','5','6','+'],[' 1','2','3','−'],['( )','0','.','÷']].map(row => (
                        <View key={row.join('')} style={{ flexDirection: 'row', gap: 6, marginBottom: 6 }}>
                          {row.map(key => {
                            const k = key.trim();
                            const isOp = ['+','−','÷'].includes(k);
                            const isBack = k === '⌫';
                            const isParen = k === '( )';
                            return (
                              <Pressable key={key} onPress={() => handleCalcInput(k)}
                                style={({ pressed }) => ({ flex: 1, paddingVertical: 13, borderRadius: 7, borderWidth: 1, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.15)' : colors.card, borderColor: pressed ? 'rgba(255,255,255,0.3)' : colors.border })}>
                                <Text style={{ color: isOp ? colors.accent : isBack ? colors.textMuted : isParen ? colors.accent : colors.text, fontSize: isOp ? 20 : 16, fontWeight: isOp || isBack ? '600' : '500' }}>{k}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ))}
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCalcVisible(false); }}
                          style={({ pressed }) => ({ flex: 1, paddingVertical: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
                          <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={applyCalcResult}
                          style={{ flex: 2, paddingVertical: 11, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center' }}>
                          <Text style={{ color: '#000', fontWeight: '700' }}>OK</Text>
                        </Pressable>
                      </View>
                    </View>
                  )}

                  {/* Tip presets */}
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>Tip %</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                    {TIP_PRESETS.map(pct => {
                      const active = customTip === '' && selectedTip === pct;
                      return (
                        <Pressable key={pct} onPress={() => pickPreset(pct)}
                          style={({ pressed }) => ({ flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1, alignItems: 'center', borderColor: active ? colors.accent : colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : active ? colors.accent + '22' : colors.background })}>
                          <Text style={{ color: active ? colors.accent : colors.textMuted, fontWeight: '600', fontSize: 13 }}>{pct}%</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Custom tip */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>Custom</Text>
                    <TextInput
                      value={customTip}
                      onChangeText={v => { setCustomTip(v); }}
                      keyboardType="decimal-pad"
                      placeholder="e.g. 18"
                      placeholderTextColor={colors.textMuted}
                      style={{ flex: 1, backgroundColor: colors.background, color: colors.text, borderRadius: 8, borderWidth: 1, borderColor: customTip !== '' ? colors.accent : colors.border, padding: 9, fontSize: 14, textAlign: 'center' }}
                    />
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>%</Text>
                  </View>

                  {/* Results */}
                  <View style={{ backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 16 }}>
                    <Row label="Tip" value={billNum > 0 ? fmt(tipAmt) : '—'} colors={colors} />
                    <Row label="Total" value={billNum > 0 ? fmt(total) : '—'} colors={colors} bold />
                    {perPerson && billNum > 0 && (
                      <Row label={`Per person (÷${split})`} value={fmt(perPerson)} colors={colors} accent />
                    )}
                  </View>

                  {/* Split */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 13 }}>Split between</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSplit(s => Math.max(1, s - 1)); }}
                        style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background, alignItems: 'center', justifyContent: 'center' })}>
                        <Text style={{ color: colors.text, fontSize: 18, lineHeight: 22 }}>−</Text>
                      </Pressable>
                      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16, minWidth: 20, textAlign: 'center' }}>{split}</Text>
                      <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSplit(s => Math.min(20, s + 1)); }}
                        style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : colors.background, alignItems: 'center', justifyContent: 'center' })}>
                        <Text style={{ color: colors.text, fontSize: 18, lineHeight: 22 }}>+</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTipVisible(false); }}
                      style={({ pressed }) => ({ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}>
                      <Text style={{ color: colors.textMuted, fontWeight: '600' }}>Done</Text>
                    </Pressable>
                    <Pressable onPress={addTipTransaction}
                      style={{ flex: 2, paddingVertical: 12, borderRadius: 8, backgroundColor: total > 0 ? colors.accent : colors.border, alignItems: 'center', opacity: total > 0 ? 1 : 0.4 }}>
                      <Text style={{ color: '#000', fontWeight: '700' }}>Add Transaction</Text>
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


function Row({ label, value, colors, bold, accent }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ color: colors.textMuted, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: accent ? colors.accent : colors.text, fontSize: 13, fontWeight: bold || accent ? '700' : '500' }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { borderBottomWidth: 1 },
  inner: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 12 },
  side: { width: 44, alignItems: 'flex-end' },
  center: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  chevron: { fontSize: 14, marginTop: 2 },
  gearBtn: { padding: 4 },
  gear: { fontSize: 22 },
  dropdown: {
    position: 'absolute', borderWidth: 1, borderRadius: 10, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 10, zIndex: 100,
  },
  dropdownItem: { paddingVertical: 14, paddingHorizontal: 20 },
  dropdownText: { fontSize: 15, fontWeight: '500' },
});
