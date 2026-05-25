import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { authApi } from '../lib/api';
import { saveToken } from '../lib/auth';

const PIN_LENGTH = 4;
const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

interface Props { onSuccess: () => void; }

export default function LoginScreen({ onSuccess }: Props) {
  const [pin, setPin]         = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [status, setStatus]   = useState('');
  const [seconds, setSeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pinRef   = useRef('');

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function startCountup() {
    setSeconds(0);
    timerRef.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
  }

  function stopCountup() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setSeconds(0);
  }

  async function attemptLogin(pinValue: string) {
    setLoading(true);
    setError('');
    setStatus('Connecting to server…');
    startCountup();

    try {
      const { token } = await authApi.login(pinValue);
      stopCountup();
      await saveToken(token);
      onSuccess();
    } catch (e: any) {
      stopCountup();
      if (e?.message === 'TIMEOUT') {
        setError('Server timed out. Please try again.');
      } else if (e?.message === 'Incorrect PIN') {
        setError('Incorrect PIN. Please try again.');
      } else {
        setError('Could not connect. Check your internet.');
      }
      setPin('');
    } finally {
      setLoading(false);
      setStatus('');
    }
  }

  const handleKey = async (key: string) => {
    if (loading) return;

    if (key === '⌫') {
      setPin(p => p.slice(0, -1));
      setError('');
      return;
    }

    const next = pin + key;
    setPin(next);
    setError('');
    pinRef.current = next;

    if (next.length === PIN_LENGTH) {
      await attemptLogin(next);
    }
  };

  const statusText = loading
    ? seconds > 5
      ? `Server is starting up… (${seconds}s)`
      : status
    : 'Enter your PIN to continue';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <Text style={styles.logo}>A1</Text>
        <Text style={styles.title}>A1 Groups</Text>
        <Text style={styles.subtitle}>{statusText}</Text>

        {/* PIN dots / loading indicator */}
        {loading ? (
          <View style={styles.spinnerBox}>
            <ActivityIndicator color="#7B61FF" size="large" />
          </View>
        ) : (
          <View style={styles.dotsRow}>
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>
        )}

        {/* Error */}
        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <Text style={styles.errorPlaceholder} />
        )}

        {/* Keypad */}
        <View style={[styles.keypad, loading && styles.keypadDisabled]}>
          {KEYS.map((k, i) =>
            k === '' ? (
              <View key={i} style={styles.keyEmpty} />
            ) : (
              <TouchableOpacity
                key={i}
                style={[styles.key, k === '⌫' && styles.keyDelete, loading && styles.keyDisabled]}
                onPress={() => handleKey(k)}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={[styles.keyText, k === '⌫' && styles.keyDeleteText]}>{k}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontSize: 48,
    fontWeight: '800',
    color: '#7B61FF',
    letterSpacing: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
    marginTop: 4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#8888aa',
    marginBottom: 40,
    textAlign: 'center',
  },
  spinnerBox: {
    height: 58,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 20,
    marginBottom: 12,
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#7B61FF',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#7B61FF',
  },
  error: {
    color: '#ff5c5c',
    fontSize: 13,
    marginBottom: 20,
    height: 18,
    textAlign: 'center',
  },
  errorPlaceholder: {
    height: 18,
    marginBottom: 20,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 270,
    gap: 16,
    justifyContent: 'center',
  },
  keypadDisabled: {
    opacity: 0.35,
  },
  key: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#1e1e30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    width: 76,
    height: 76,
  },
  keyDelete: {
    backgroundColor: '#2a1e30',
  },
  keyDisabled: {
    opacity: 0.5,
  },
  keyText: {
    fontSize: 26,
    fontWeight: '600',
    color: '#ffffff',
  },
  keyDeleteText: {
    fontSize: 22,
    color: '#cc66cc',
  },
});
