import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { clearToken, isSessionExpired } from '../lib/auth';
import { authApi } from '../lib/api';
import { AuthContext } from '../lib/AuthContext';
import LoginScreen from './login';

export default function RootLayout() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed]     = useState(false);
  const appState = useRef(AppState.currentState);

  async function checkAuth() {
    const expired = await isSessionExpired();
    if (expired) {
      await clearToken();
      setAuthed(false);
    } else {
      setAuthed(true);
    }
  }

  useEffect(() => {
    checkAuth().finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === 'active') {
        checkAuth();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const logout = async () => {
    authApi.logout().catch(() => {});
    await clearToken();
    setAuthed(false);
  };

  if (checking) return null;

  if (!authed) return <LoginScreen onSuccess={() => setAuthed(true)} />;

  return (
    <AuthContext.Provider value={{ logout }}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      <StatusBar style="auto" />
    </AuthContext.Provider>
  );
}
