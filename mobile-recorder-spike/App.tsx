import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { Encounter } from './src/api';
import { AuthProvider, useAuth } from './src/auth';
import { PickEncounterScreen } from './src/screens/pick-encounter';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';

function Root() {
  const { ready, token } = useAuth();
  const [selected, setSelected] = useState<Encounter | null>(null);

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (selected) return <RecordScreen encounter={selected} onDone={() => setSelected(null)} />;
  return <PickEncounterScreen onSelect={setSelected} />;
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
