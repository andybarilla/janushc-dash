import { useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';

export function SignInScreen() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);

  async function onPress() {
    setBusy(true);
    try {
      await signIn();
    } catch (err) {
      Alert.alert('Sign-in failed', String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>JanusHC Recorder</Text>
      <Text style={styles.body}>Sign in with your JanusHC Google account to record visits.</Text>
      <Button title={busy ? 'Signing in…' : 'Sign in with Google'} onPress={onPress} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', gap: 16, padding: 24, backgroundColor: '#ffffff' },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  body: { color: '#475569', textAlign: 'center', lineHeight: 20 },
});
