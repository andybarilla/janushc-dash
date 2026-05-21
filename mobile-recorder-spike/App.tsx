import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

type SavedRecording = {
  uri: string;
  durationMillis: number;
  createdAt: string;
  patientLabel: string;
  sizeBytes?: number;
};

const DEFAULT_API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:8080';

const STORAGE_KEYS = {
  apiBaseUrl: 'janushc-spike:apiBaseUrl',
  token: 'janushc-spike:token',
  saved: 'janushc-spike:saved',
};

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
}

export default function RecorderSpike() {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [patientLabel, setPatientLabel] = useState('Test patient / encounter');
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [spikeToken, setSpikeToken] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMillis, setDurationMillis] = useState(0);
  const [saved, setSaved] = useState<SavedRecording[]>([]);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(console.warn);
  }, []);

  // Restore the upload endpoint and any saved recordings. The saved list is
  // persisted so a recording survives the app being backgrounded or killed
  // during the lock-screen test — exactly the failure mode the spike probes.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.apiBaseUrl)
      .then((value) => {
        if (value) setApiBaseUrl(value);
      })
      .catch(console.warn);
    AsyncStorage.getItem(STORAGE_KEYS.token)
      .then((value) => {
        if (value) setSpikeToken(value);
      })
      .catch(console.warn);
    AsyncStorage.getItem(STORAGE_KEYS.saved)
      .then((value) => {
        if (value) setSaved(JSON.parse(value) as SavedRecording[]);
      })
      .catch(console.warn);
  }, []);

  function onChangeApiBaseUrl(value: string) {
    setApiBaseUrl(value);
    AsyncStorage.setItem(STORAGE_KEYS.apiBaseUrl, value).catch(console.warn);
  }

  function onChangeSpikeToken(value: string) {
    setSpikeToken(value);
    AsyncStorage.setItem(STORAGE_KEYS.token, value).catch(console.warn);
  }

  function persistSaved(next: SavedRecording[]) {
    AsyncStorage.setItem(STORAGE_KEYS.saved, JSON.stringify(next)).catch(console.warn);
  }

  async function startRecording() {
    if (!consentConfirmed) {
      Alert.alert('Consent required', 'Confirm patient consent before starting the recording.');
      return;
    }

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone permission denied', 'Enable microphone access to run the spike.');
      return;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
    });

    if (keepAwake) await activateKeepAwakeAsync('janushc-recorder-spike');

    const recording = new Audio.Recording();
    recording.setOnRecordingStatusUpdate((status) => {
      if (status.isRecording || status.durationMillis > 0) setDurationMillis(status.durationMillis);
    });
    recording.setProgressUpdateInterval(1000);
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
    recordingRef.current = recording;
    setIsRecording(true);
  }

  async function stopRecording() {
    const recording = recordingRef.current;
    if (!recording) return;

    await recording.stopAndUnloadAsync();
    deactivateKeepAwake('janushc-recorder-spike');
    const status = await recording.getStatusAsync();
    const uri = recording.getURI();
    recordingRef.current = null;
    setIsRecording(false);

    if (!uri) {
      Alert.alert('No recording URI returned');
      return;
    }

    const info = await FileSystem.getInfoAsync(uri);
    setSaved((current) => {
      const next: SavedRecording[] = [
        {
          uri,
          durationMillis: status.durationMillis ?? durationMillis,
          createdAt: new Date().toISOString(),
          patientLabel,
          sizeBytes: info.exists ? info.size : undefined,
        },
        ...current,
      ];
      persistSaved(next);
      return next;
    });
  }

  async function uploadRecording(item: SavedRecording) {
    // Spike endpoint shape. Backend can later swap this for signed S3 multipart upload.
    const form = new FormData();
    form.append('patient_label', item.patientLabel);
    form.append('created_at', item.createdAt);
    form.append('audio', {
      uri: item.uri,
      name: `janushc-${Date.now()}.m4a`,
      type: 'audio/m4a',
    } as unknown as Blob);

    const endpoint = `${apiBaseUrl.replace(/\/+$/, '')}/api/mobile/recordings`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${spikeToken}` },
      body: form,
    });
    Alert.alert(response.ok ? 'Upload complete' : 'Upload failed', `HTTP ${response.status}`);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Recording reliability spike</Text>
      <Text style={styles.note}>Test on real iOS/Android devices: start recording, lock the phone for 30–60 minutes, unlock, stop, and confirm duration/file size.</Text>

      <Text style={styles.label}>Patient / encounter label</Text>
      <TextInput value={patientLabel} onChangeText={setPatientLabel} style={styles.input} />

      <Text style={styles.label}>Spike upload endpoint</Text>
      <TextInput
        value={apiBaseUrl}
        onChangeText={onChangeApiBaseUrl}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.x.x:8080"
      />
      <Text style={styles.hint}>Point at the deployed API, e.g. https://dash.janushc.com.</Text>

      <Text style={styles.label}>Spike upload token</Text>
      <TextInput
        value={spikeToken}
        onChangeText={onChangeSpikeToken}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="MOBILE_SPIKE_TOKEN value"
      />
      <Text style={styles.hint}>Must match MOBILE_SPIKE_TOKEN on the server.</Text>

      <View style={styles.row}>
        <Text>Consent confirmed</Text>
        <Switch value={consentConfirmed} onValueChange={setConsentConfirmed} />
      </View>
      <View style={styles.row}>
        <Text>Keep screen awake fallback</Text>
        <Switch value={keepAwake} onValueChange={setKeepAwake} />
      </View>

      <Text style={styles.timer}>{formatDuration(durationMillis)}</Text>
      <Button title={isRecording ? 'Stop recording' : 'Start recording'} color={isRecording ? '#b91c1c' : '#166534'} onPress={isRecording ? stopRecording : startRecording} />

      <Text style={styles.subtitle}>Saved recordings</Text>
      {saved.map((item) => (
        <View key={item.uri} style={styles.card}>
          <Text style={styles.cardTitle}>{item.patientLabel}</Text>
          <Text>{formatDuration(item.durationMillis)} • {item.sizeBytes ?? 'unknown'} bytes</Text>
          <Text selectable>{item.uri}</Text>
          <Button title="Upload to spike endpoint" onPress={() => uploadRecording(item).catch((error) => Alert.alert('Upload error', String(error)))} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '700', marginTop: 16 },
  note: { color: '#475569', lineHeight: 20 },
  hint: { color: '#64748b', fontSize: 12, marginTop: -8 },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timer: { fontSize: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  card: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8 },
  cardTitle: { fontWeight: '700' },
});
