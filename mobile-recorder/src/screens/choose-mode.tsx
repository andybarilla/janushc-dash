import { Button, StyleSheet, Text, View } from 'react-native';

export type CaptureMode = 'record' | 'scan';

export function ChooseModeScreen({
  label,
  onChoose,
  onBack,
}: {
  label: string;
  onChoose: (mode: CaptureMode) => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.screen}>
      <Text style={styles.patient}>{label}</Text>
      <Text style={styles.help}>What do you want to capture?</Text>
      <Button title="Record audio" color="#166534" onPress={() => onChoose('record')} />
      <Button title="Scan document" color="#166534" onPress={() => onChoose('scan')} />
      <Button title="Back" onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  patient: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  help: { color: '#64748b' },
});
