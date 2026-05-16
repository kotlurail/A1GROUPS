import React, { createContext, useContext, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getToken, clearToken } from '../lib/auth';
import LoginScreen from './login';

interface AuthCtx { logout: () => Promise<void>; }
export const AuthContext = createContext<AuthCtx>({ logout: async () => {} });
export const useAuth = () => useContext(AuthContext);

export default function RootLayout() {
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed]     = useState(false);

  useEffect(() => {
    getToken().then(t => {
      setAuthed(!!t);
      setChecking(false);
    });
  }, []);

  const logout = async () => {
    await clearToken();
    setAuthed(false);
  };

  // Still reading stored token — show nothing (splash is still visible)
  if (checking) return null;

  // Not authenticated — show PIN screen
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
