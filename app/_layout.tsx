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
import { useIsRegularWidth } from '@/src/hooks/useIsRegularWidth';
import {
  awaitSaveInFlight,
  hydrateSessionFromStorage,
} from '@/src/recording/activeRecordingSession';
import { getThemePreferenceSync } from '@/src/settings/appSettings';
import { purgeExpiredTrash } from '@/src/storage/memoStore';
import { applyThemePreference } from '@/src/theme/applyThemePreference';
import { useVoiceMemosColors } from '@/src/theme/useVoiceMemosColors';
import { recoverMemoLiveActivity } from '@/src/widgets/recordingLiveActivityController';
import '@/src/widgets/RecordingLiveActivity';

applyThemePreference(getThemePreferenceSync());

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

function buildGroupedHeaderOptions(
  colors: VoiceMemosColorScheme,
  colorScheme: 'light' | 'dark' | null | undefined
) {
  const surfaceColor =
    colorScheme === 'dark' ? colors.background : colors.editorCanvasBackground;
  return buildHeaderOptions(colors, surfaceColor);
}

function RootNavigator() {
  const colors = useVoiceMemosColors();
  const colorScheme = useColorScheme();
  const isRegularWidth = useIsRegularWidth();
  const groupedScreenOptions = useMemo(
    () => buildGroupedHeaderOptions(colors, colorScheme),
    [colorScheme, colors]
  );
  const screenOptions = useMemo(() => buildHeaderOptions(colors), [colors]);

  const memoScreenOptions = useMemo(() => {
    if (isRegularWidth) {
      // Deep links / unexpected pushes on tablet: full-screen card, not form sheet.
      return {
        title: '',
        presentation: 'card' as const,
        headerBackTitle: 'Back',
        headerTransparent: false,
        ...buildHeaderOptions(colors, colors.sheetBackground),
      };
    }
    return {
      title: '',
      presentation: 'formSheet' as const,
      sheetGrabberVisible: true,
      sheetAllowedDetents: [1],
      sheetInitialDetentIndex: 0,
      headerBackTitle: 'Back',
      headerTransparent: false,
      ...buildHeaderOptions(colors, colors.sheetBackground),
    };
  }, [colors, isRegularWidth]);

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen
          name="index"
          options={{
            ...groupedScreenOptions,
            headerLargeTitle: false,
          }}
        />
        <Stack.Screen
          name="recordings/index"
          options={{
            title: 'All Recordings',
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen
          name="folder/[id]"
          options={{
            headerLargeTitle: true,
          }}
        />
        <Stack.Screen
          name="recently-deleted/index"
          options={{
            title: 'Recently Deleted',
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
    void (async () => {
      await memoAudioEngine.requestPermission();
      await memoAudioEngine.prewarmRecordingSession();
    })();
    void purgeExpiredTrash();
    void (async () => {
      await hydrateSessionFromStorage();
      await recoverMemoLiveActivity(memoAudioEngine);
      await awaitSaveInFlight();
      if (!memoAudioEngine.getState().isRecording) {
        await memoAudioEngine.finishDeferredPlaybackSetup();
      }
    })();
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
