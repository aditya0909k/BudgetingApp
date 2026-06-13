import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { API_BASE_URL } from '../config';

const AppContext = createContext(null);
const OVERRIDE_QUEUE_KEY = 'offline_override_queue';

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
  const [pendingOverrideIds, setPendingOverrideIds] = useState(new Set());

  // Load theme
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

  // Load server data + restore any queued offline overrides
  useEffect(() => {
    fetchBudget();
    fetchExcluded();
    fetchOverrides();
    refreshAccounts();
    // Restore queued overrides to local state so edits survive app restarts
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(OVERRIDE_QUEUE_KEY);
        if (!raw) return;
        const queue = JSON.parse(raw);
        if (!queue.length) return;
        setPendingOverrideIds(new Set(queue.map(q => q.transactionId)));
        setOverrides(prev => {
          const next = { ...prev };
          for (const item of queue) {
            const resolvedNotes = item.notes || null;
            const resolvedWho = (item.who && item.who !== 'me') ? item.who : null;
            const resolvedName = item.name || null;
            if (item.amount === null || item.amount === undefined) {
              const entry = {};
              if (resolvedNotes) entry.notes = resolvedNotes;
              if (resolvedWho) entry.who = resolvedWho;
              if (resolvedName) entry.name = resolvedName;
              if (Object.keys(entry).length) next[item.transactionId] = entry;
              else delete next[item.transactionId];
            } else {
              next[item.transactionId] = { amount: parseFloat(item.amount) };
              if (item.date) next[item.transactionId].date = item.date;
              if (resolvedNotes) next[item.transactionId].notes = resolvedNotes;
              if (resolvedWho) next[item.transactionId].who = resolvedWho;
              if (resolvedName) next[item.transactionId].name = resolvedName;
            }
          }
          return next;
        });
      } catch {}
    })();
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

  // Flush queued offline overrides — called at start of fetchData in HomeScreen
  const flushOverrideQueue = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(OVERRIDE_QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw);
      if (!queue.length) return;
      const remaining = [];
      for (const item of queue) {
        try {
          const res = await fetch(`${API_BASE_URL}/api/overrides/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.overrides) setOverrides(data.overrides);
            setPendingOverrideIds(prev => { const next = new Set(prev); next.delete(item.transactionId); return next; });
          } else {
            remaining.push(item);
          }
        } catch {
          remaining.push(item);
        }
      }
      await AsyncStorage.setItem(OVERRIDE_QUEUE_KEY, JSON.stringify(remaining));
    } catch {}
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

  async function setOverride(transactionId, amount, date, notes, who, name) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setOverrides(prev => {
      const next = { ...prev };
      const resolvedNotes = notes !== undefined ? (notes || null) : (prev[transactionId]?.notes || null);
      const resolvedWho = who !== undefined ? who : (prev[transactionId]?.who || null);
      const resolvedName = name !== undefined ? (name || null) : (prev[transactionId]?.name || null);
      if (amount === null) {
        const entry = {};
        if (resolvedNotes) entry.notes = resolvedNotes;
        if (resolvedWho && resolvedWho !== 'me') entry.who = resolvedWho;
        if (resolvedName) entry.name = resolvedName;
        if (Object.keys(entry).length) next[transactionId] = entry;
        else delete next[transactionId];
      } else {
        next[transactionId] = { amount: parseFloat(amount), date };
        if (notes !== undefined) next[transactionId].notes = resolvedNotes;
        if (resolvedWho && resolvedWho !== 'me') next[transactionId].who = resolvedWho;
        if (resolvedName) next[transactionId].name = resolvedName;
      }
      return next;
    });
    try {
      const res = await fetch(`${API_BASE_URL}/api/overrides/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, amount, date, notes, who, name }),
      });
      const data = await res.json();
      if (data.overrides) setOverrides(data.overrides);
      // Synced — remove from pending queue
      setPendingOverrideIds(prev => { const next = new Set(prev); next.delete(transactionId); return next; });
    } catch (e) {
      // Offline — queue for later, mark as pending
      try {
        const raw = await AsyncStorage.getItem(OVERRIDE_QUEUE_KEY) || '[]';
        const queue = JSON.parse(raw);
        const deduped = queue.filter(q => q.transactionId !== transactionId);
        deduped.push({ transactionId, amount, date, notes, who, name });
        await AsyncStorage.setItem(OVERRIDE_QUEUE_KEY, JSON.stringify(deduped));
      } catch {}
      setPendingOverrideIds(prev => new Set([...prev, transactionId]));
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
        pendingOverrideIds,
        flushOverrideQueue,
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
