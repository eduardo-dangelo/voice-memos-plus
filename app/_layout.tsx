import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import type { VoiceMemosColorScheme } from '@/constants/VoiceMemosColors';
import { AudioEngineProvider } from '@/src/audio/AudioEngineContext';
import { memoAudioEngine } from '@/src/audio/MemoAudioEngine';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';

function buildHeaderOptions(colors: VoiceMemosColorScheme, surfaceColor = colors.background) {
  return {
    headerStyle: { backgroundColor: surfaceColor },
    headerTintColor: colors.text,
    headerTitleStyle: { color: colors.text },
    headerLargeTitleStyle: { color: colors.text },
    headerLargeStyle: { backgroundColor: surfaceColor },
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    contentStyle: { backgroundColor: surfaceColor },
  };
}

function buildSheetHeaderOptions(colors: VoiceMemosColorScheme) {
  return buildHeaderOptions(colors, colors.sheetBackground);
}

function RootNavigator() {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const screenOptions = useMemo(() => buildHeaderOptions(colors), [colors]);

  const memoScreenOptions = useMemo(
    () => ({
      title: '',
      presentation: 'formSheet' as const,
      sheetGrabberVisible: true,
      sheetAllowedDetents: [1],
      sheetInitialDetentIndex: 0,
      headerBackTitle: 'All Recordings',
      headerTransparent: false,
      ...buildSheetHeaderOptions(colors),
    }),
    [colors]
  );

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen
          name="index"
          options={{
            title: 'All Recordings',
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen name="memo/[id]" options={memoScreenOptions} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void memoAudioEngine.requestPermission();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AudioEngineProvider>
          <RootNavigator />
        </AudioEngineProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
