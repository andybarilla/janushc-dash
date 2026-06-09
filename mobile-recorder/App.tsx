import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { upsertPending } from './src/pending';
import { LabelEntryScreen } from './src/screens/label-entry';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';
import { PendingItem } from './src/upload-queue';

function Root() {
  const { ready, token } = useAuth();
  const [label, setLabel] = useState<string | null>(null);
  // Recordings whose upload has not yet succeeded, held in memory so "Later"
  // does not orphan them. Not persisted across an app restart (deliberate v1).
  const [pending, setPending] = useState<PendingItem[]>([]);

  function settle(item: PendingItem) {
    setPending((prev) => upsertPending(prev, item));
  }

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (label) {
    // resume is null in label mode: a freeform label is not a stable, unique key
    // (two patients could share initials), so we never reuse a held session
    // across recordings. The hold still guards against orphaning within a single
    // record session. Resume-by-key returns when the appointment picker does.
    return (
      <RecordScreen
        label={label}
        resume={null}
        onSettle={settle}
        onDone={() => setLabel(null)}
      />
    );
  }
  return <LabelEntryScreen onSelect={setLabel} />;
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
