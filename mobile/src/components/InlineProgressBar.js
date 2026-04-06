import React from 'react';
import { View } from 'react-native';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function InlineProgressBar({ spent, budget }) {
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);

  const pct = budget > 0 ? Math.min(spent / budget, 1) : 0;

  let fillColor;
  if (pct >= 1) fillColor = colors.danger;
  else if (pct >= 0.75) fillColor = colors.warning;
  else fillColor = colors.accent;

  return (
    <View
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: colors.gaugeTrack,
        marginTop: 8,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.round(pct * 100)}%`,
          height: '100%',
          backgroundColor: fillColor,
          borderRadius: 2,
        }}
      />
    </View>
  );
}
