import React, { useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';
import { getTheme } from '../theme';
import { useAppContext } from '../context/AppContext';

export default function SkeletonRow() {
  const { theme } = useAppContext();
  const colors = getTheme(theme.mode, theme.accentColor);
  const anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const bar = (w, h = 12) => (
    <Animated.View
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        backgroundColor: colors.border,
        opacity: anim,
      }}
    />
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ gap: 8 }}>
        {bar(140, 14)}
        {bar(90)}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        {bar(60, 14)}
        {bar(70)}
      </View>
    </View>
  );
}
