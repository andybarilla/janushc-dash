import { Audio } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, StyleSheet, Switch, Text, View } from 'react-native';
import { Encounter } from '../api';
import { useAuth } from '../auth';
import { pendingFor } from '../pending';
import { runUpload } from '../upload';
import { PendingItem } from '../upload-queue';

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((p) => String(p).padStart(2, '0')).join(':');
}

export function RecordScreen({
  encounter,
  resume,
  onDone,
  onSettle,
}: {
  encounter: Encounter;
  // A held attempt for this encounter, if any; its session is reused on upload.
  resume?: PendingItem | null;
  // Leave the screen and return to the encounter list.
  onDone: () => void;
  // Record where an upload landed: a still-pending item is held in memory for a
  // later resume, a `done` item clears any held copy. Called the instant an
  // attempt settles so no exit path (alert dismiss, back button) can orphan it.
  onSettle: (item: PendingItem) => void;
}) {
  const { token, baseUrl, signOut } = useAuth();
  // Flag a 401 so the failure prompt is suppressed while the app drops to
  // sign-in, rather than blaming the network.
  const signedOut = useRef(false);
  const opts = useMemo(
    () => ({ baseUrl, token, onUnauthorized: () => { signedOut.current = true; signOut(); } }),
    [baseUrl, token, signOut],
  );
  const recordingRef = useRef<Audio.Recording | null>(null);

  const [consent, setConsent] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMillis, setDurationMillis] = useState(0);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
    }).catch(console.warn);
  }, []);

  useEffect(() => {
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      deactivateKeepAwake('janushc-recorder');
    };
  }, []);

  async function startRecording() {
    if (!consent) {
      Alert.alert('Consent required', 'Confirm patient consent before recording.');
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone permission denied');
      return;
    }
    if (keepAwake) await activateKeepAwakeAsync('janushc-recorder');

    try {
      const recording = new Audio.Recording();
      recording.setOnRecordingStatusUpdate((status) => {
        if (status.isRecording || status.durationMillis > 0) setDurationMillis(status.durationMillis);
      });
      recording.setProgressUpdateInterval(1000);
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      deactivateKeepAwake('janushc-recorder');
      recordingRef.current = null;
      setIsRecording(false);
      Alert.alert('Recording failed', String(err));
    }
  }

  async function stopRecording() {
    const recording = recordingRef.current;
    if (!recording) return;
    let uri: string | null = null;
    try {
      await recording.stopAndUnloadAsync();
      uri = recording.getURI();
    } catch (err) {
      Alert.alert('Stop failed', String(err));
    } finally {
      deactivateKeepAwake('janushc-recorder');
      recordingRef.current = null;
      setIsRecording(false);
    }
    if (!uri) {
      Alert.alert('No recording URI returned');
      return;
    }
    await upload(uri);
  }

  async function upload(fileUri: string) {
    await attempt(pendingFor(encounter, fileUri, resume), 'Upload incomplete');
  }

  async function attempt(item: PendingItem, failureTitle: string) {
    setUploading(true);
    const result = await runUpload(opts, item);
    setUploading(false);
    // Hold (or clear, when done) before prompting, so dismissing the alert or
    // hitting Back can no longer orphan the recording.
    onSettle(result);

    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Recording sent to the scribe inbox.');
      onDone();
    } else if (signedOut.current) {
      onDone();
    } else {
      Alert.alert(failureTitle, 'The recording is saved on this device. Retry?', [
        { text: 'Later', style: 'cancel', onPress: onDone },
        { text: 'Retry', onPress: () => attempt(result, 'Still failing') },
      ]);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{encounter.patient_name || encounter.patient_id}</Text>
      <Text style={styles.meta}>Encounter {encounter.encounter_id}</Text>

      <View style={styles.row}>
        <Text style={styles.body}>Consent confirmed</Text>
        <Switch value={consent} onValueChange={setConsent} disabled={isRecording} />
      </View>
      <View style={styles.row}>
        <Text style={styles.body}>Keep screen awake</Text>
        <Switch value={keepAwake} onValueChange={setKeepAwake} disabled={isRecording} />
      </View>

      <Text style={styles.timer}>{formatDuration(durationMillis)}</Text>

      {uploading ? (
        <Text style={styles.body}>Uploading…</Text>
      ) : (
        <Button
          title={isRecording ? 'Stop & upload' : 'Start recording'}
          color={isRecording ? '#b91c1c' : '#166534'}
          onPress={isRecording ? stopRecording : startRecording}
        />
      )}

      {!isRecording && !uploading && <Button title="Back to encounters" onPress={() => onDone()} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  meta: { color: '#64748b' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  body: { color: '#1e293b' },
  timer: { fontSize: 48, textAlign: 'center', fontVariant: ['tabular-nums'], color: '#0f172a' },
});
