import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';
import { useAuth } from '../_layout';

export default function SettingsScreen() {
  const { logout } = useAuth();
  const isDark = useColorScheme() === 'dark';
  const bg   = isDark ? '#12102B' : '#EEF0FF';
  const card = isDark ? '#1E1B3A' : '#FFFFFF';
  const text = isDark ? '#F0EDFF' : '#1A1A2E';
  const sub  = isDark ? '#9B98C0' : '#6E6E8D';

  function confirmLogout() {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Logout', style: 'destructive', onPress: logout },
      ]
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: card }]}>
        <Text style={[styles.headerTitle, { color: text }]}>Settings</Text>
      </View>

      <View style={styles.body}>
        {/* App info card */}
        <View style={[styles.card, { backgroundColor: card }]}>
          <View style={styles.appRow}>
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>A1</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.appName, { color: text }]}>A1 Groups</Text>
              <Text style={[styles.appSub, { color: sub }]}>Business Management App</Text>
            </View>
          </View>
        </View>

        {/* Session info */}
        <View style={[styles.card, { backgroundColor: card }]}>
          <Text style={[styles.sectionLabel, { color: sub }]}>SESSION</Text>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: text }]}>PIN expires after</Text>
            <Text style={[styles.infoValue, { color: '#7B61FF' }]}>24 hours</Text>
          </View>
        </View>

        {/* Logout button */}
        <TouchableOpacity style={styles.logoutBtn} onPress={confirmLogout} activeOpacity={0.85}>
          <Text style={styles.logoutIcon}>🚪</Text>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <Text style={[styles.hint, { color: sub }]}>
          You'll need to enter your PIN again after logout.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(123,97,255,0.12)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  body: {
    flex: 1,
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    shadowColor: '#7B61FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#7B61FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  appName: {
    fontSize: 17,
    fontWeight: '700',
  },
  appSub: {
    fontSize: 13,
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,77,77,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.3)',
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 8,
  },
  logoutIcon: {
    fontSize: 20,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FF4D4D',
  },
  hint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
