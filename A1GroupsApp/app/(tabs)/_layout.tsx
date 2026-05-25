import { Tabs } from 'expo-router';
import { Platform, Text, View } from 'react-native';
import { useColorScheme } from 'react-native';

const TABS = [
  { name: 'index',         title: 'Rentals',   icon: '📦' },
  { name: 'decor',         title: 'Decors',    icon: '🎨' },
  { name: 'decorEstimate', title: 'Estimates', icon: '📋' },
  { name: 'employees',     title: 'Staff',     icon: '👤' },
  { name: 'accounts',      title: 'Accounts',  icon: '💰' },
  { name: 'bookings',      title: 'Bookings',  icon: '📅' },
  { name: 'settings',      title: 'Settings',  icon: '⚙️' },
];

function TabIcon({ icon, focused }: { icon: string; focused: boolean }) {
  return (
    <View style={{
      alignItems: 'center', justifyContent: 'center',
      width: 44, height: 30, borderRadius: 15,
      backgroundColor: focused ? 'rgba(123,97,255,0.14)' : 'transparent',
    }}>
      <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.45 }}>{icon}</Text>
    </View>
  );
}

export default function TabLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: isDark ? '#1E1B3A' : '#FFFFFF',
          borderTopWidth: 0,
          height:         Platform.OS === 'ios' ? 84 : 66,
          paddingBottom:  Platform.OS === 'ios' ? 24 : 10,
          paddingTop:     8,
          shadowColor:    '#7B61FF',
          shadowOffset:   { width: 0, height: -4 },
          shadowOpacity:  0.08,
          shadowRadius:   16,
          elevation:      12,
        },
        tabBarActiveTintColor:   '#7B61FF',
        tabBarInactiveTintColor: isDark ? '#4A4870' : '#B0AFCE',
        tabBarLabelStyle: {
          fontSize:      10,
          fontWeight:    '700',
          letterSpacing: 0.2,
          marginTop:     2,
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
