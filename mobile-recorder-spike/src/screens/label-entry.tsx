import { useState } from 'react';
import { Button, StyleSheet, Text, TextInput, View } from 'react-native';

export function LabelEntryScreen({ onSelect }: { onSelect: (label: string) => void }) {
  const [label, setLabel] = useState('');
  const trimmed = label.trim();

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Identify this recording</Text>
      <Text style={styles.help}>
        Type a name, initials, or patient ID — whatever lets you match it in Athena later.
      </Text>
      <TextInput
        style={styles.input}
        value={label}
        onChangeText={setLabel}
        placeholder="e.g. Jane D. or 12345"
        placeholderTextColor="#94a3b8"
        autoFocus
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => trimmed && onSelect(trimmed)}
      />
      <Button
        title="Continue"
        color="#166534"
        onPress={() => trimmed && onSelect(trimmed)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: '#ffffff' },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  help: { color: '#64748b' },
  input: {
    borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, color: '#0f172a',
  },
});
