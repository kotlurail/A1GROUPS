import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY    = 'a1groups_auth_token';
const LOGIN_TS_KEY = 'a1groups_login_ts';
const SESSION_TTL  = 24 * 60 * 60 * 1000; // 24 hours in ms

// ─── Token ────────────────────────────────────────────────────────────────────

export async function saveToken(token: string): Promise<void> {
  const ts = Date.now().toString();
  if (Platform.OS === 'web') {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(LOGIN_TS_KEY, ts);
  } else {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await SecureStore.setItemAsync(LOGIN_TS_KEY, ts);
  }
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LOGIN_TS_KEY);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(LOGIN_TS_KEY);
  }
}

// ─── Expiry check ─────────────────────────────────────────────────────────────

async function getLoginTimestamp(): Promise<number | null> {
  let raw: string | null;
  if (Platform.OS === 'web') {
    raw = localStorage.getItem(LOGIN_TS_KEY);
  } else {
    raw = await SecureStore.getItemAsync(LOGIN_TS_KEY);
  }
  if (!raw) return null;
  const ts = parseInt(raw, 10);
  return isNaN(ts) ? null : ts;
}

/** Returns true if no token exists OR the session is older than 24 hours. */
export async function isSessionExpired(): Promise<boolean> {
  const token = await getToken();
  if (!token) return true;

  const ts = await getLoginTimestamp();
  if (!ts) return true; // no timestamp → treat as expired

  return Date.now() - ts > SESSION_TTL;
}
