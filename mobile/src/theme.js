export function getTheme(mode, accentColor) {
  const dark = mode === 'dark';
  return {
    background: dark ? '#0a0f1e' : '#f5f5f5',
    card: dark ? '#141929' : '#ffffff',
    border: dark ? '#1e2a45' : '#e0e0e0',
    text: dark ? '#ffffff' : '#111111',
    textMuted: dark ? '#8892a4' : '#666666',
    accent: accentColor || '#4ade80',
    gaugeTrack: dark ? '#1e2a45' : '#e0e0e0',
    success: '#4ade80',
    warning: '#fbbf24',
    danger: '#f87171',
    excludedBg: dark ? '#2a1a1a' : '#fde8e8',
    excludedText: '#f87171',
  };
}
