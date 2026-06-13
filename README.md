# Voice Memos Plus

An iOS Voice Memos–style app built with Expo SDK 56 and `react-native-audio-api`.

## Features (v1)

- Record single-layer voice memos
- All Recordings list with search, select, and inline playback
- Full editor with waveform scrubbing, trim handles, and Replace
- Share, rename, duplicate, and delete recordings
- Local storage (`manifest.json` + `layer-0.m4a` per memo)

## Requirements

- macOS with Xcode
- Node.js 20+
- iOS Simulator or physical device
- **Development build required** (`react-native-audio-api` is not available in Expo Go)

## Setup

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios
```

If native binaries fail on first build:

```bash
node node_modules/react-native-audio-api/scripts/download-prebuilt-binaries.sh ios
npx expo run:ios
```

If you see a sandbox error like `deny(1) file-write-create .../resources-to-copy-VoiceMemosPlus.txt`, Xcode's User Script Sandboxing is blocking CocoaPods. The project's `ios/Podfile` already disables this in `post_install`. If it returns after `expo prebuild`, run:

```bash
cd ios && pod install && cd ..
npx expo run:ios
```

Or in Xcode: **Build Settings → User Script Sandboxing → No**.

## Project structure

```
app/                 Expo Router screens (list + editor)
src/audio/           Audio engine, waveform utilities
src/storage/         Memo CRUD and file paths
src/components/      UI components
```

## Manual test checklist

- [ ] Record from FAB → memo appears in list with correct duration
- [ ] Inline play/pause and skip ±15s from list row
- [ ] Editor scrub, trim handles, playback respects trim region
- [ ] Replace re-records selected region and updates waveform
- [ ] Share exports a playable M4A
- [ ] Rename, duplicate, delete, and search work

## Deferred (future iterations)

- Multi-layer recording with monitor mix
- Per-layer reverb/delay effects
- Android support
