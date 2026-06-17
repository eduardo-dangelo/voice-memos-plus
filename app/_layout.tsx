import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-reanimated';

import { VoiceMemosColors } from '@/constants/VoiceMemosColors';
import { AudioEngineProvider } from '@/src/audio/AudioEngineContext';
import { memoAudioEngine } from '@/src/audio/MemoAudioEngine';

export default function RootLayout() {
  useEffect(() => {
    void memoAudioEngine.requestPermission();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AudioEngineProvider>
          <Stack>
            <Stack.Screen
              name="index"
              options={{
                title: 'All Recordings',
                headerLargeTitle: true,
              }}
            />
            <Stack.Screen
              name="memo/[id]"
              options={{
                title: '',
                presentation: 'formSheet',
                sheetGrabberVisible: true,
                sheetAllowedDetents: [1],
                sheetInitialDetentIndex: 0,
                headerBackTitle: 'All Recordings',
                headerTransparent: false,
                contentStyle: { backgroundColor: VoiceMemosColors.background },
              }}
            />
          </Stack>
        </AudioEngineProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
