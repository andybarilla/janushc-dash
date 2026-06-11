import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { upsertPending } from './src/pending';
import { CaptureMode, ChooseModeScreen } from './src/screens/choose-mode';
import { LabelEntryScreen } from './src/screens/label-entry';
import { RecordScreen } from './src/screens/record';
import { ScanScreen } from './src/screens/scan';
import { SignInScreen } from './src/screens/sign-in';
import { PendingItem } from './src/upload-queue';

function Root() {
  const { ready, token } = useAuth();
  const [label, setLabel] = useState<string | null>(null);
  const [mode, setMode] = useState<CaptureMode | null>(null);
  // Captures whose upload has not yet succeeded, held in memory so "Later" does
  // not orphan them. Not persisted across an app restart (deliberate v1).
  const [pending, setPending] = useState<PendingItem[]>([]);

  function settle(item: PendingItem) {
    setPending((prev) => upsertPending(prev, item));
  }

  // Return to label entry after a capture settles or the user backs out.
  function reset() {
    setMode(null);
    setLabel(null);
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (!label) return <LabelEntryScreen onSelect={(l) => { setLabel(l); setMode(null); }} />;
  if (!mode) {
    return <ChooseModeScreen label={label} onChoose={setMode} onBack={reset} />;
  }
  if (mode === 'record') {
    // resume is null: a freeform label is not a stable, unique key (two patients
    // could share initials), so we never reuse a held session across captures.
    return <RecordScreen label={label} resume={null} onSettle={settle} onDone={reset} />;
  }
  return <ScanScreen label={label} onSettle={settle} onDone={reset} />;
}

export default function App() {
  return (
    <View style={styles.app}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <AuthProvider>
        <Root />
      </AuthProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, paddingTop: Constants.statusBarHeight, backgroundColor: '#ffffff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#ffffff' },
});
