import { useMemo, useRef, useState } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth';
import { pendingFor } from '../pending';
import { scanToPdf } from '../scan';
import { runUpload } from '../upload';
import { PendingItem } from '../upload-queue';

export function ScanScreen({
  label,
  onDone,
  onSettle,
}: {
  label: string;
  onDone: () => void;
  onSettle: (item: PendingItem) => void;
}) {
  const { token, baseUrl, signOut } = useAuth();
  const signedOut = useRef(false);
  const opts = useMemo(
    () => ({ baseUrl, token, onUnauthorized: () => { signedOut.current = true; signOut(); } }),
    [baseUrl, token, signOut],
  );
  const [busy, setBusy] = useState(false);

  async function startScan() {
    setBusy(true);
    let pdfUri: string | null;
    try {
      pdfUri = await scanToPdf();
    } catch (err) {
      setBusy(false);
      Alert.alert('Scan failed', String(err));
      return;
    }
    if (!pdfUri) {
      setBusy(false);
      return; // user cancelled the scanner
    }
    await attempt(pendingFor(label, pdfUri, 'document', null), 'Upload incomplete');
  }

  async function attempt(item: PendingItem, failureTitle: string) {
    const result = await runUpload(opts, item);
    setBusy(false);
    // Hold (or clear, when done) before prompting so dismissing the alert or
    // hitting Back cannot orphan the scan.
    onSettle(result);

    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Document sent to the scribe inbox.');
      onDone();
    } else if (signedOut.current) {
      onDone();
    } else {
      Alert.alert(failureTitle, 'The scan is saved on this device. Retry?', [
        { text: 'Later', style: 'cancel', onPress: onDone },
        { text: 'Retry', onPress: () => { setBusy(true); attempt(result, 'Still failing'); } },
      ]);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{label}</Text>
      {busy ? (
        <Text style={styles.body}>Working…</Text>
      ) : (
        <>
          <Button title="Scan document" color="#166534" onPress={startScan} />
          <Button title="Back" onPress={onDone} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  body: { color: '#1e293b' },
});
