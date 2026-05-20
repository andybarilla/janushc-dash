# Mobile recorder spike

Goal: prove whether a native mobile app can reliably record a 30–60 minute clinical visit while the phone is locked, then preserve/upload the audio without forcing the clinician to keep the screen awake.

## Spike app

A minimal Expo/React Native app lives in `mobile-recorder-spike/`. It is pinned to Expo SDK 54 / React Native 0.81 because the newer SDK 55 / React Native 0.85 stack currently hits a Metro/codegen failure on Android export (`VirtualViewExperimentalNativeComponent` / `onModeChange`).

It tests:

- microphone permission flow
- consent confirmation gate
- long-running recording
- iOS background audio mode configuration
- Android foreground-service-related permissions in the manifest
- optional keep-awake fallback toggle, for comparison only
- local file URI, duration, and file-size validation
- placeholder multipart upload to `/api/mobile/recordings`

## Run on devices

This must be tested on real phones. Simulators are not enough for lock-screen/background behavior.

```bash
cd mobile-recorder-spike
npm install
npm run ios      # iOS device, via Xcode/dev client
npm run android  # Android device
npm run export:android # CI/EAS-style Android bundle smoke test
npx eas-cli build -p android # requires node_modules locally so EAS can resolve config plugins
```

For iOS, use a development build because the app config includes `UIBackgroundModes: ["audio"]`.

## Test protocol

Run this once on iOS and once on Android.

1. Open the app.
2. Enter a patient/encounter test label.
3. Confirm consent.
4. Leave `Keep screen awake fallback` off.
5. Start recording.
6. Lock the phone.
7. Leave it locked for 30 minutes, then repeat with 60 minutes if the first test passes.
8. Unlock the phone.
9. Stop recording.
10. Confirm:
    - timer is close to expected duration
    - saved file URI exists
    - file size is non-zero and plausible
    - playback or upload can access the file
11. Repeat with an interruption:
    - phone call/Siri/notification interruption on iOS
    - app switch/background on Android
    - temporary network loss before upload

## Pass/fail criteria

Pass:

- recording continues while locked for at least 60 minutes
- no data loss after unlock/stop
- file remains accessible for upload
- battery use is acceptable for clinic workflows
- interruption behavior is understandable and recoverable

Fail / needs native module:

- recording stops when locked
- app is killed silently during recording
- Android requires a proper foreground service notification not provided by Expo APIs
- iOS interruptions corrupt or lose the recording
- large file upload is unreliable without chunking/resume

## Expected next backend shape

The spike app currently posts multipart form data to:

```http
POST /api/mobile/recordings
```

Initial production shape should likely become:

1. `POST /api/mobile/recording-sessions` creates a recording session.
2. App uploads audio with a signed S3 URL or multipart upload.
3. `POST /api/mobile/recording-sessions/{id}/complete` marks upload complete.
4. Backend creates a transcription job and links result to a scribe session.

## Platform notes

### iOS

`app.json` configures `UIBackgroundModes: ["audio"]` and `expo-av` recording mode uses `staysActiveInBackground: true`. Apple review should be acceptable only if background recording is clearly a core product feature and user-visible.

### Android

Modern Android usually expects a persistent foreground service notification for long-running background microphone capture. The spike includes permissions, but if real-device tests are flaky, the likely next step is a small native module or React Native library that owns a microphone foreground service.
