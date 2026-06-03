import Constants from 'expo-constants';
import { useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from './src/auth';
import { LabelEntryScreen } from './src/screens/label-entry';
import { RecordScreen } from './src/screens/record';
import { SignInScreen } from './src/screens/sign-in';

function Root() {
  const { ready, token } = useAuth();
  const [label, setLabel] = useState<string | null>(null);

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) return <SignInScreen />;
  if (label) return <RecordScreen label={label} onDone={() => setLabel(null)} />;
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
