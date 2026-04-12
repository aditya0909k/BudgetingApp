import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { API_BASE_URL } from '../config';

const AppContext = createContext(null);

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
  const [overrides, setOverrides] = useState({});
  const [linkedAccounts, setLinkedAccounts] = useState([]);
  const [theme, setThemeState] = useState({ mode: 'dark', accentColor: '#4ade80' });

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
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    fetchBudget();
    fetchExcluded();
    fetchOverrides();
    refreshAccounts();
  }, []);

  async function fetchBudget() {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/budget`);
      const data = await res.json();
      if (data.weeklyBudget) setWeeklyBudgetState(data.weeklyBudget);
    } catch (e) {}
  }

  async function fetchExcluded() {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/excluded`);
      const data = await res.json();
      if (data.excludedIds) setExcludedIds(new Set(data.excludedIds));
    } catch (e) {}
  }

  async function fetchOverrides() {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/overrides`);
      const data = await res.json();
      if (data.overrides) setOverrides(data.overrides);
    } catch (e) {}
  }

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/api/accounts`);
      const data = await res.json();
      if (data.accounts) setLinkedAccounts(data.accounts);
    } catch (e) {}
  }, []);

  function setWeeklyBudget(val) {
    setWeeklyBudgetState(val);
  }

  async function toggleExcluded(transactionId) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
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
      fetchExcluded();
    }
  }

  async function setOverride(transactionId, amount, date, notes) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOverrides(prev => {
      const next = { ...prev };
      const resolvedNotes = notes !== undefined ? (notes || null) : (prev[transactionId]?.notes || null);
      if (amount === null) {
        if (resolvedNotes) next[transactionId] = { notes: resolvedNotes };
        else delete next[transactionId];
      } else {
        next[transactionId] = { amount: parseFloat(amount), date };
        if (notes !== undefined) next[transactionId].notes = resolvedNotes;
      }
      return next;
    });
    try {
      const res = await fetch(`${API_BASE_URL}/api/overrides/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, amount, date, notes }),
      });
      const data = await res.json();
      if (data.overrides) setOverrides(data.overrides);
    } catch (e) {
      fetchOverrides();
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
        overrides,
        setOverride,
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
