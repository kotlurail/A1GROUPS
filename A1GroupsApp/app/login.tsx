import React, { useState } from 'react';
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
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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

    if (next.length === PIN_LENGTH) {
      setLoading(true);
      try {
        const { token } = await authApi.login(next);
        await saveToken(token);
        onSuccess();
      } catch {
        setError('Incorrect PIN. Please try again.');
        setPin('');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        {/* Header */}
        <Text style={styles.logo}>A1</Text>
        <Text style={styles.title}>A1 Groups</Text>
        <Text style={styles.subtitle}>Enter your PIN to continue</Text>

        {/* PIN dots */}
        <View style={styles.dotsRow}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
          ))}
        </View>

        {/* Error */}
        {error ? <Text style={styles.error}>{error}</Text> : <Text style={styles.errorPlaceholder} />}

        {/* Keypad */}
        <View style={styles.keypad}>
          {KEYS.map((k, i) =>
            k === '' ? (
              <View key={i} style={styles.keyEmpty} />
            ) : (
              <TouchableOpacity
                key={i}
                style={[styles.key, k === '⌫' && styles.keyDelete]}
                onPress={() => handleKey(k)}
                disabled={loading}
                activeOpacity={0.7}
              >
                <Text style={[styles.keyText, k === '⌫' && styles.keyDeleteText]}>{k}</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        {loading && <ActivityIndicator color="#6C63FF" size="large" style={{ marginTop: 24 }} />}
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
    color: '#6C63FF',
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
    borderColor: '#6C63FF',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#6C63FF',
  },
  error: {
    color: '#ff5c5c',
    fontSize: 13,
    marginBottom: 20,
    height: 18,
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
