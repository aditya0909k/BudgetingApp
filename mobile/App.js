import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from './src/context/AppContext';

import HomeScreen from './src/screens/HomeScreen';
import WeeklyScreen from './src/screens/WeeklyScreen';
import MonthlyScreen from './src/screens/MonthlyScreen';
import WeekDetailScreen from './src/screens/WeekDetailScreen';
import MonthDetailScreen from './src/screens/MonthDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <AppProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Weekly" component={WeeklyScreen} />
            <Stack.Screen name="Monthly" component={MonthlyScreen} />
            <Stack.Screen name="WeekDetail" component={WeekDetailScreen} />
            <Stack.Screen name="MonthDetail" component={MonthDetailScreen} />
            <Stack.Screen name="Settings" component={SettingsScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
