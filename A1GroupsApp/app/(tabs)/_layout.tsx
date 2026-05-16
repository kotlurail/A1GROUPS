import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const ICONS: Record<string, string> = {
  home: '🏠',
  explore: '🔍',
  employees: '👥',
  accounts: '⚙️',
  bookings: '📅',
  decor: '🎉',
  decorEstimate: '📊',
};

function TabIcon({ name }: { name: string }) {
  return <Text style={{ fontSize: 20 }}>{ICONS[name]}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#6C63FF' }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Rentals', tabBarIcon: () => <TabIcon name="home" /> }}
      />
      <Tabs.Screen
        name="decor"
        options={{ title: 'Decors', tabBarIcon: () => <TabIcon name="decor" /> }}
      />
      <Tabs.Screen
        name="decorEstimate"
        options={{ title: 'Decor Estimate', tabBarIcon: () => <TabIcon name="decorEstimate" /> }}
      />
      <Tabs.Screen
        name="employees"
        options={{ title: 'Employee', tabBarIcon: () => <TabIcon name="employees" /> }}
      />
      <Tabs.Screen
        name="accounts"
        options={{ title: 'Accounts', tabBarIcon: () => <TabIcon name="accounts" /> }}
      />
      <Tabs.Screen
        name="bookings"
        options={{ title: 'Bookings', tabBarIcon: () => <TabIcon name="bookings" /> }}
      />
    </Tabs>
  );
}
