import React, { useState, useEffect, useRef } from 'react';
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';
import { formatCurrency } from '../utils';

const WIDTH = 300;
const HEIGHT = 260;
const CX = WIDTH / 2;
const CY = HEIGHT / 2 + 10;
const RADIUS = 110;
const STROKE_WIDTH = 18;

// Arc spans 280°, open at the bottom.
// Start angle: 130° from positive x-axis (bottom-left)
// End angle: 50° (bottom-right), sweeping clockwise
const START_DEG = 130;
const END_DEG = 50;
const TOTAL_DEG = 280;

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = degToRad(angleDeg);
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function arcPath(cx, cy, r, startDeg, endDeg, clockwise = true) {
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  // Large arc flag: 1 if arc spans > 180°
  const angleDiff = clockwise
    ? (endDeg - startDeg + 360) % 360
    : (startDeg - endDeg + 360) % 360;
  const largeArc = angleDiff > 180 ? 1 : 0;
  const sweep = clockwise ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${end.x} ${end.y}`;
}

// Track: full 280° from START_DEG to END_DEG clockwise
const TRACK_PATH = arcPath(CX, CY, RADIUS, START_DEG, END_DEG, true);

export default function ArcGauge({ spent, budget, accentColor, period = 'week' }) {
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, accentColor || theme.accentColor);

  const targetPct = budget > 0 ? Math.min(spent / budget, 1) : 0;
  const remaining = budget - spent;
  const overBudget = spent > budget;

  // Animate fill from 0 → targetPct on mount / value change
  const [animPct, setAnimPct] = useState(0);
  const rafRef = useRef(null);
  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let startTs = null;
    const duration = 700;
    function frame(ts) {
      if (!startTs) startTs = ts;
      const progress = Math.min((ts - startTs) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimPct(eased * targetPct);
      if (progress < 1) rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [targetPct]);

  const pct = animPct;

  // Fill arc: from START_DEG sweeping clockwise by pct * TOTAL_DEG
  const fillEndDeg = START_DEG + pct * TOTAL_DEG;
  const fillPath = pct > 0
    ? arcPath(CX, CY, RADIUS, START_DEG, fillEndDeg, true)
    : null;

  // Color logic
  let fillColor;
  if (targetPct >= 1) fillColor = colors.danger;
  else if (targetPct >= 0.75) fillColor = colors.warning;
  else fillColor = accentColor || colors.accent;

  const spentLabel = formatCurrency(spent);
  const budgetLabel = `of ${formatCurrency(budget)} budget`;

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Fixed-size container so the absolute overlay anchors to the SVG, not the screen edge */}
      <View style={{ width: WIDTH, height: HEIGHT }}>
        <Svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
          {/* Background track */}
          <Path
            d={TRACK_PATH}
            fill="none"
            stroke={overBudget ? colors.danger : colors.gaugeTrack}
            strokeOpacity={overBudget ? 0.3 : 1}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
          {/* Fill arc */}
          {fillPath && (
            <Path
              d={fillPath}
              fill="none"
              stroke={fillColor}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
            />
          )}
        </Svg>

        {/* Center text — absolutely positioned at arc center (CX=150, CY=140).
            Fill the entire container; paddingTop shifts the flex-center from
            HEIGHT/2=130 to CY=140 (delta = +10, so paddingTop = 2*10 = 20). */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: WIDTH,
            height: HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
            paddingTop: 2 * (CY - HEIGHT / 2),
          }}
        >
          <Text style={{ fontSize: 36, fontWeight: '700', color: overBudget ? colors.danger : colors.text }}>
            {spentLabel}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            {budgetLabel}
          </Text>
        </View>
      </View>

      {/* Below gauge: remaining / over budget */}
      <Text
        style={{
          fontSize: 15,
          fontWeight: '600',
          color: overBudget ? colors.danger : colors.text,
          marginTop: -8,
          marginBottom: 12,
          textAlign: 'center',
        }}
      >
        {overBudget
          ? `Over by ${formatCurrency(Math.abs(remaining))}`
          : `${formatCurrency(remaining)} remaining this ${period}`}
      </Text>
    </View>
  );
}
