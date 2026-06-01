import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { Appointment } from './src/api';
import { AuthProvider, useAuth } from './src/auth';
import { upsertPending } from './src/pending';
import { PickAppointmentScreen } from './src/screens/pick-appointment';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';
import { PendingItem } from './src/upload-queue';

function Root() {
  const { ready, token } = useAuth();
  const [selected, setSelected] = useState<Appointment | null>(null);
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
  if (selected) {
    return (
      <RecordScreen
        appointment={selected}
        resume={pending.find((p) => p.id === selected.appointment_id) ?? null}
        onSettle={settle}
        onDone={() => setSelected(null)}
      />
    );
  }
  return <PickAppointmentScreen onSelect={setSelected} pending={pending} onResolve={settle} />;
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
