import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator,
  Dimensions, PanResponder,
} from 'react-native';
import Svg, {
  Path, Circle, Line, Text as SvgText, Defs, LinearGradient, Stop,
} from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';
import { formatCurrency, getCurrentWeekRange } from '../utils';
import { API_BASE_URL } from '../config';
import CustomHeader from '../components/CustomHeader';
import { useFocusEffect } from '@react-navigation/native';

const SCREEN_W = Dimensions.get('window').width;
const CHART_W = SCREEN_W - 32;
const CHART_H = 220;
const PAD = { t: 12, b: 30, l: 50, r: 12 };
const IW = CHART_W - PAD.l - PAD.r;
const IH = CHART_H - PAD.t - PAD.b;

const SMOS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SDOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PERIODS = ['1W','1M','3M','6M','1Y','all'];
const PERIOD_KEY = 'trends_last_period';
const PERIOD_TITLE = {
  '1W': 'This Week', '1M': 'Last 5 Weeks', '3M': 'Last 13 Weeks',
  '6M': 'Last 6 Months', '1Y': 'Last 12 Months', all: 'All Time',
};
const INSIGHT_TITLE = {
  '1W': 'Day over Day', '1M': 'Week over Week', '3M': 'Week over Week',
  '6M': 'Month over Month', '1Y': 'Month over Month', all: 'Month over Month',
};

function niceGrid(maxV) {
  if (maxV <= 0) return [0];
  const raw = maxV / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const step = [1, 2, 5, 10].map(f => f * mag).find(s => s >= raw) || mag;
  const out = [];
  for (let v = 0; v <= maxV * 1.01; v += step) out.push(Math.round(v));
  return out;
}

function fmtY(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(1).replace('.0', '')}k`;
  return `$${v}`;
}

function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  const n = pts.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i+1].x - pts[i].x;
    dy[i] = pts[i+1].y - pts[i].y;
    m[i] = dy[i] / dx[i];
  }
  const t = new Array(n);
  t[0] = m[0];
  t[n-1] = m[n-2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i-1] * m[i] <= 0 ? 0 : (m[i-1] + m[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(m[i]) < 1e-10) { t[i] = t[i+1] = 0; continue; }
    const a = t[i] / m[i], b = t[i+1] / m[i], s = a*a + b*b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); t[i] = tau*a*m[i]; t[i+1] = tau*b*m[i]; }
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    d += ` C ${(pts[i].x + h/3).toFixed(1)} ${(pts[i].y + t[i]*h/3).toFixed(1)} ${(pts[i+1].x - h/3).toFixed(1)} ${(pts[i+1].y - t[i+1]*h/3).toFixed(1)} ${pts[i+1].x.toFixed(1)} ${pts[i+1].y.toFixed(1)}`;
  }
  return d;
}

export default function TrendsScreen() {
  const { theme, overrides, excludedIds } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);
  const insets = useSafeAreaInsets();
  const accent = colors.accent;

  const [period, setPeriod] = useState('1M');
  const [weeklyHist, setWeeklyHist] = useState([]);
  const [monthlyHist, setMonthlyHist] = useState([]);
  const [rawWeekTxns, setRawWeekTxns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scrubIdx, setScrubIdx] = useState(-1);

  const ptsRef = useRef([]);
  const lastIdxRef = useRef(-1);

  useEffect(() => {
    AsyncStorage.getItem(PERIOD_KEY).then(p => {
      if (p && PERIODS.includes(p)) setPeriod(p);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { startDate } = getCurrentWeekRange();
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const endDate = (() => {
        const dt = new Date(sy, sm - 1, sd + 6);
        return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      })();

      const [wr, mr, tr] = await Promise.all([
        fetch(`${API_BASE_URL}/api/history/weekly`),
        fetch(`${API_BASE_URL}/api/history/monthly`),
        fetch(`${API_BASE_URL}/api/transactions?startDate=${startDate}&endDate=${endDate}`),
      ]);
      const [wd, md, td] = await Promise.all([wr.json(), mr.json(), tr.json()]);

      setWeeklyHist((wd.history || []).sort((a, b) => a.startDate > b.startDate ? 1 : -1));
      setMonthlyHist((md.history || []).sort((a, b) => a.startDate > b.startDate ? 1 : -1));
      setRawWeekTxns(td.transactions || []);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Daily totals for 1W — applies overrides and excludedIds from context
  const dailyData = useMemo(() => {
    const { startDate } = getCurrentWeekRange();
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const totals = {};
    for (const tx of rawWeekTxns) {
      if (excludedIds.has(tx.transaction_id)) continue;
      const effectiveDate = overrides[tx.transaction_id]?.date ?? tx.date;
      const effectiveAmount = overrides[tx.transaction_id]?.amount ?? tx.amount;
      if (typeof effectiveAmount === 'number' && effectiveAmount > 0) {
        totals[effectiveDate] = (totals[effectiveDate] || 0) + effectiveAmount;
      }
    }
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(sy, sm - 1, sd + i);
      const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      return { label: SDOW[dt.getDay()], amount: parseFloat((totals[key] || 0).toFixed(2)) };
    });
  }, [rawWeekTxns, overrides, excludedIds]);

  function avail(p) {
    const mc = monthlyHist.length, wc = weeklyHist.length;
    if (p === '1W' || p === '1M' || p === 'all') return true;
    if (p === '3M') return mc >= 2 || wc >= 10;
    if (p === '6M') return mc >= 5;
    if (p === '1Y') return mc >= 10;
    return true;
  }

  function pick(p) {
    if (!avail(p)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPeriod(p);
    setScrubIdx(-1);
    AsyncStorage.setItem(PERIOD_KEY, p).catch(() => {});
  }

  const chartData = useMemo(() => {
    const wkLabel = s => { const [,m,d] = s.split('-').map(Number); return `${SMOS[m-1]} ${d}`; };
    const moLabel = s => {
      const [y, m] = s.split('-').map(Number);
      return monthlyHist.length > 13
        ? `${SMOS[m-1]}'${String(y).slice(2)}`
        : SMOS[m - 1];
    };
    switch (period) {
      case '1W': return dailyData;
      case '1M': return weeklyHist.slice(-5).map(w => ({ label: wkLabel(w.startDate), amount: w.totalSpent || 0 }));
      case '3M': return weeklyHist.slice(-13).map(w => ({ label: wkLabel(w.startDate), amount: w.totalSpent || 0 }));
      case '6M': return monthlyHist.slice(-6).map(m => ({ label: moLabel(m.startDate), amount: m.totalSpent || 0 }));
      case '1Y': return monthlyHist.slice(-12).map(m => ({ label: moLabel(m.startDate), amount: m.totalSpent || 0 }));
      case 'all': return monthlyHist.map(m => ({ label: moLabel(m.startDate), amount: m.totalSpent || 0 }));
      default: return [];
    }
  }, [period, dailyData, weeklyHist, monthlyHist]);

  const { pts, yMax } = useMemo(() => {
    if (!chartData.length) return { pts: [], yMax: 0 };
    const maxV = Math.max(...chartData.map(d => d.amount), 1);
    const yMx = maxV * 1.2;
    const n = chartData.length;
    return {
      pts: chartData.map((d, i) => ({
        x: PAD.l + (n > 1 ? i / (n - 1) : 0.5) * IW,
        y: PAD.t + (1 - d.amount / yMx) * IH,
        amount: d.amount,
        label: d.label,
      })),
      yMax: yMx,
    };
  }, [chartData]);

  ptsRef.current = pts;

  const panR = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => {
      const x = e.nativeEvent.locationX;
      const p = ptsRef.current;
      if (!p.length) return;
      const idx = p.reduce((b, pt, i) => Math.abs(pt.x - x) < Math.abs(p[b].x - x) ? i : b, 0);
      lastIdxRef.current = idx;
      setScrubIdx(idx);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onPanResponderMove: e => {
      const x = e.nativeEvent.locationX;
      const p = ptsRef.current;
      if (!p.length) return;
      const idx = p.reduce((b, pt, i) => Math.abs(pt.x - x) < Math.abs(p[b].x - x) ? i : b, 0);
      if (idx !== lastIdxRef.current) {
        lastIdxRef.current = idx;
        setScrubIdx(idx);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    onPanResponderRelease: () => { lastIdxRef.current = -1; setScrubIdx(-1); },
    onPanResponderTerminate: () => { lastIdxRef.current = -1; setScrubIdx(-1); },
  })).current;

  const grid = useMemo(() => niceGrid(yMax / 1.2), [yMax]);
  const linePath = useMemo(() => smoothPath(pts), [pts]);
  const areaPath = useMemo(() => {
    if (!pts.length) return '';
    const bot = PAD.t + IH;
    return `${linePath} L ${pts[pts.length-1].x.toFixed(1)} ${bot} L ${pts[0].x.toFixed(1)} ${bot} Z`;
  }, [linePath, pts]);

  const scrubPt = scrubIdx >= 0 && scrubIdx < pts.length ? pts[scrubIdx] : null;
  const xStep = Math.max(1, Math.ceil(pts.length / 7));
  const showAllDots = pts.length <= 13;

  // Insights: most recent first, compare each to previous
  const insights = useMemo(() => {
    return chartData.map((d, i) => ({
      label: d.label,
      amount: d.amount,
      pct: i > 0 && chartData[i-1].amount > 0
        ? (d.amount - chartData[i-1].amount) / chartData[i-1].amount * 100
        : null,
      delta: i > 0 ? d.amount - chartData[i-1].amount : null,
    }));
  }, [chartData]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <CustomHeader />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={accent} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <CustomHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} showsVerticalScrollIndicator={false} scrollEnabled={scrubIdx < 0}>

        {/* Period selector */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 6 }}>
          {PERIODS.map(p => {
            const on = period === p;
            const ok = avail(p);
            return (
              <Pressable key={p} onPress={() => pick(p)} style={({ pressed }) => ({
                flex: 1, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
                alignItems: 'center', opacity: ok ? 1 : 0.32,
                borderColor: on ? accent : colors.border,
                backgroundColor: on ? accent + '22' : pressed && ok ? 'rgba(255,255,255,0.08)' : 'transparent',
              })}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: on ? accent : ok ? colors.text : colors.textMuted }}>
                  {p === 'all' ? 'All' : p}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Chart card */}
        <View style={{ marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 12 }}>

          {/* Header — scrub value or period label */}
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, minHeight: 68 }}>
            {scrubPt ? (
              <>
                <Text style={{ fontSize: 30, fontWeight: '700', color: colors.text }}>{formatCurrency(scrubPt.amount)}</Text>
                <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{scrubPt.label}</Text>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>{PERIOD_TITLE[period]}</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 3 }}>Hold to explore</Text>
              </>
            )}
          </View>

          {/* SVG chart */}
          <View {...panR.panHandlers} style={{ width: CHART_W, height: CHART_H }}>
            <Svg width={CHART_W} height={CHART_H}>
              <Defs>
                <LinearGradient id="ag" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={accent} stopOpacity={scrubPt ? '0.1' : '0.3'} />
                  <Stop offset="1" stopColor={accent} stopOpacity="0" />
                </LinearGradient>
              </Defs>

              {/* Y grid lines + labels */}
              {grid.map(v => {
                const y = PAD.t + (1 - v / yMax) * IH;
                if (y < PAD.t - 2 || y > PAD.t + IH + 2) return null;
                return (
                  <React.Fragment key={v}>
                    <Line
                      x1={PAD.l} y1={y} x2={CHART_W - PAD.r} y2={y}
                      stroke={colors.border} strokeWidth={0.8} opacity={0.55}
                    />
                    <SvgText x={PAD.l - 4} y={y + 4} textAnchor="end" fontSize={9} fill={colors.textMuted}>
                      {fmtY(v)}
                    </SvgText>
                  </React.Fragment>
                );
              })}

              {/* Area fill */}
              {areaPath ? <Path d={areaPath} fill="url(#ag)" /> : null}

              {/* Line — dim while scrubbing so dot stands out */}
              {linePath ? (
                <Path
                  d={linePath} fill="none" stroke={accent} strokeWidth={2.5}
                  strokeLinecap="round" strokeLinejoin="round"
                  opacity={scrubPt ? 0.35 : 1}
                />
              ) : null}

              {/* X axis labels — hide while scrubbing */}
              {!scrubPt && pts.map((pt, i) => {
                if (pts.length > 1 && i % xStep !== 0 && i !== pts.length - 1) return null;
                return (
                  <SvgText key={i} x={pt.x} y={CHART_H - 6} textAnchor="middle" fontSize={9} fill={colors.textMuted}>
                    {pt.label}
                  </SvgText>
                );
              })}

              {/* Crosshair vertical line */}
              {scrubPt && (
                <Line
                  x1={scrubPt.x} y1={PAD.t} x2={scrubPt.x} y2={PAD.t + IH}
                  stroke={accent} strokeWidth={1.5} opacity={0.45}
                />
              )}

              {/* Dots */}
              {pts.map((pt, i) => {
                const isScrub = scrubPt && scrubIdx === i;
                const isEndpoint = i === 0 || i === pts.length - 1;
                if (!isScrub && !isEndpoint && !showAllDots) return null;
                return (
                  <React.Fragment key={i}>
                    {isScrub && <Circle cx={pt.x} cy={pt.y} r={14} fill={accent} opacity={0.1} />}
                    <Circle
                      cx={pt.x} cy={pt.y}
                      r={isScrub ? 5.5 : 3}
                      fill={colors.card}
                      stroke={accent}
                      strokeWidth={isScrub ? 2.5 : 1.8}
                      opacity={isScrub ? 1 : scrubPt ? 0.4 : 1}
                    />
                  </React.Fragment>
                );
              })}

              {/* Empty state */}
              {pts.length === 0 && (
                <SvgText
                  x={CHART_W / 2} y={CHART_H / 2}
                  textAnchor="middle" fontSize={13} fill={colors.textMuted}
                >
                  No data yet
                </SvgText>
              )}
            </Svg>
          </View>
        </View>

        {/* Insights card */}
        <View style={{ marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
            {INSIGHT_TITLE[period]}
          </Text>

          {insights.length === 0 && (
            <Text style={{ color: colors.textMuted, fontSize: 13, padding: 16, paddingTop: 0, textAlign: 'center' }}>
              No data yet.
            </Text>
          )}

          {insights.map((item, i) => {
            const isUp = item.pct !== null && item.pct > 0;
            const isDn = item.pct !== null && item.pct < 0;
            const isFlat = item.pct !== null && item.pct === 0;
            return (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 12, paddingHorizontal: 16,
                borderTopWidth: 1, borderTopColor: colors.border,
              }}>
                {/* Period label */}
                <Text style={{ flex: 1, color: colors.textMuted, fontSize: 13 }}>{item.label}</Text>

                {/* Amount */}
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600', marginRight: 12 }}>
                  {formatCurrency(item.amount)}
                </Text>

                {/* Change indicator */}
                {item.pct !== null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 72, justifyContent: 'flex-end' }}>
                    <Text style={{ fontSize: 14, marginRight: 3, color: isDn ? colors.accent : isFlat ? colors.textMuted : colors.danger }}>
                      {isDn ? '▼' : isFlat ? '—' : '▲'}
                    </Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: isDn ? colors.accent : isFlat ? colors.textMuted : colors.danger }}>
                      {Math.abs(item.pct).toFixed(1)}%
                    </Text>
                  </View>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: 12, minWidth: 72, textAlign: 'right' }}>—</Text>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
