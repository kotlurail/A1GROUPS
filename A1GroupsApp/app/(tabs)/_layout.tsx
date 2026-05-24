import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useColorScheme } from 'react-native';

const TABS = [
  { name: 'index',         title: 'Rentals',    icon: '📦' },
  { name: 'decor',         title: 'Decors',     icon: '🎨' },
  { name: 'decorEstimate', title: 'Estimates',  icon: '📋' },
  { name: 'employees',     title: 'Staff',      icon: '👤' },
  { name: 'accounts',      title: 'Accounts',   icon: '💰' },
  { name: 'bookings',      title: 'Bookings',   icon: '📅' },
];

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
      borderRadius: 10, backgroundColor: focused ? '#6C63FF18' : 'transparent' }}>
      <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.55 }}>{icon}</Text>
    </View>
  );
}

export default function TabLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const tabBar = {
    backgroundColor:     isDark ? '#161B22' : '#FFFFFF',
    borderTopWidth:      1,
    borderTopColor:      isDark ? '#30363D' : '#F0F1F5',
    height:              Platform.OS === 'ios' ? 82 : 64,
    paddingBottom:       Platform.OS === 'ios' ? 22 : 8,
    paddingTop:          8,
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle:            tabBar,
        tabBarActiveTintColor:  '#6C63FF',
        tabBarInactiveTintColor: isDark ? '#555E6D' : '#9CA3AF',
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          letterSpacing: 0.2,
          marginTop: 2,
        },
      }}
    >
      {TABS.map(tab => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused }) => <TabIcon icon={tab.icon} focused={focused} />,
          }}
        />
      ))}
    </Tabs>
  );
}
