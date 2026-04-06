import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { API_BASE_URL } from '../config';

const AppContext = createContext(null);

// Retry a fetch up to `attempts` times with a 1.5s delay between tries.
async function fetchWithRetry(url, options, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 1500));
      } else {
        throw e;
      }
    }
  }
}

export function AppProvider({ children }) {
  const [weeklyBudget, setWeeklyBudgetState] = useState(250);
  const [excludedIds, setExcludedIds] = useState(new Set());
  const [linkedAccounts, setLinkedAccounts] = useState([]);
  const [theme, setThemeState] = useState({ mode: 'dark', accentColor: '#4ade80' });

  // ─── Load persisted theme on mount ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [mode, accent] = await Promise.all([
          AsyncStorage.getItem('themeMode'),
          AsyncStorage.getItem('accentColor'),
        ]);
        setThemeState(prev => ({
          mode: mode || prev.mode,
          accentColor: accent || prev.accentColor,
        }));
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // ─── Fetch initial data ─────────────────────────────────────────────────────
  useEffect(() => {
    fetchBudget();
    fetchExcluded();
    refreshAccounts();
  }, []);

  async function fetchBudget() {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/budget`);
      const data = await res.json();
      if (data.weeklyBudget) setWeeklyBudgetState(data.weeklyBudget);
    } catch (e) {
      // server not reachable — keep default
    }
  }

  async function fetchExcluded() {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/excluded`);
      const data = await res.json();
      if (data.excludedIds) setExcludedIds(new Set(data.excludedIds));
    } catch (e) {
      // ignore
    }
  }

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/accounts`);
      const data = await res.json();
      if (data.accounts) setLinkedAccounts(data.accounts);
    } catch (e) {
      // ignore
    }
  }, []);

  // ─── Actions ────────────────────────────────────────────────────────────────

  function setWeeklyBudget(val) {
    setWeeklyBudgetState(val);
  }

  async function toggleExcluded(transactionId) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Optimistic update
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(transactionId)) {
        next.delete(transactionId);
      } else {
        next.add(transactionId);
      }
      return next;
    });

    try {
      const res = await fetch(`${API_BASE_URL}/api/excluded/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId }),
      });
      const data = await res.json();
      if (data.excludedIds) setExcludedIds(new Set(data.excludedIds));
    } catch (e) {
      // revert on error by re-fetching
      fetchExcluded();
    }
  }

  function setTheme(updates) {
    setThemeState(prev => {
      const next = { ...prev, ...updates };
      if (updates.mode !== undefined) AsyncStorage.setItem('themeMode', updates.mode).catch(() => {});
      if (updates.accentColor !== undefined) AsyncStorage.setItem('accentColor', updates.accentColor).catch(() => {});
      return next;
    });
  }

  return (
    <AppContext.Provider
      value={{
        weeklyBudget,
        setWeeklyBudget,
        excludedIds,
        toggleExcluded,
        linkedAccounts,
        refreshAccounts,
        theme,
        setTheme,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}
