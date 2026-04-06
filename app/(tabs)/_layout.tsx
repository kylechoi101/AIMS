import React from 'react';
import { Tabs } from 'expo-router';
import { MessagesSquare, Settings2 } from 'lucide-react-native';
import { useColorScheme } from 'react-native';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          elevation: 0,
        },
        headerStyle: {
          backgroundColor: colors.card,
          shadowOpacity: 0,
          elevation: 0,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.background }
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Idea Rooms',
          tabBarIcon: ({ color }) => <MessagesSquare size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <Settings2 size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}
