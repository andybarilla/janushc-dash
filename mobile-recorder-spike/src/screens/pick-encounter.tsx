import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Department, Encounter, listDepartments, listEncounters } from '../api';
import { useAuth } from '../auth';
import { runUpload } from '../upload';
import { PendingItem } from '../upload-queue';

export function PickEncounterScreen({
  onSelect,
  pending,
  onResolve,
}: {
  onSelect: (e: Encounter) => void;
  pending: PendingItem[];
  onResolve: (item: PendingItem) => void;
}) {
  const { token, baseUrl, signOut } = useAuth();
  const opts = useMemo(() => ({ baseUrl, token, onUnauthorized: signOut }), [baseUrl, token, signOut]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);

  async function resume(item: PendingItem) {
    setResuming(item.id);
    let signedOut = false;
    const result = await runUpload(
      { ...opts, onUnauthorized: () => { signedOut = true; signOut(); } },
      item,
    );
    setResuming(null);
    onResolve(result);
    if (result.status === 'done') {
      Alert.alert('Uploaded', 'Recording sent to the scribe inbox.');
    } else if (!signedOut) {
      Alert.alert('Still failing', 'Try again from a better connection.');
    }
  }

  useEffect(() => {
    listDepartments(opts)
      .then((d) => {
        setDepartments(d);
        if (d.length > 0) setDepartmentId(d[0].id);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadEncounters = useCallback(() => {
    if (!departmentId) return;
    setLoading(true);
    setError(null);
    listEncounters(opts, departmentId)
      .then(setEncounters)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  useEffect(loadEncounters, [loadEncounters]);

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Select encounter</Text>

      <View style={styles.depRow}>
        {departments.map((d) => (
          <Pressable
            key={d.id}
            onPress={() => setDepartmentId(d.id)}
            style={[styles.chip, d.id === departmentId && styles.chipActive]}
          >
            <Text style={[styles.chipText, d.id === departmentId && styles.chipTextActive]}>{d.name}</Text>
          </Pressable>
        ))}
      </View>

      {error && <Text style={styles.error}>{error}</Text>}
      {loading && <ActivityIndicator />}

      <FlatList
        data={encounters}
        keyExtractor={(e) => e.encounter_id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadEncounters} />}
        ListHeaderComponent={
          pending.length > 0 ? (
            <View style={styles.pendingBox}>
              <Text style={styles.pendingTitle}>Pending uploads</Text>
              {pending.map((p) => (
                <View key={p.id} style={styles.pendingRow}>
                  <Text style={styles.pendingName}>Encounter {p.encounterId}</Text>
                  {resuming === p.id ? (
                    <ActivityIndicator />
                  ) : (
                    <Button title="Retry" disabled={resuming !== null} onPress={() => resume(p)} />
                  )}
                </View>
              ))}
            </View>
          ) : null
        }
        ListEmptyComponent={!loading ? <Text style={styles.empty}>No encounters today.</Text> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onSelect(item)}>
            <Text style={styles.rowName}>{item.patient_name || item.patient_id}</Text>
            <Text style={styles.rowMeta}>{item.start_time ? `${item.start_time} · ${item.date}` : item.date}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: '#ffffff' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  depRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipActive: { backgroundColor: '#166534', borderColor: '#166534' },
  chipText: { color: '#0f172a' },
  chipTextActive: { color: '#ffffff' },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  rowName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  rowMeta: { color: '#64748b', marginTop: 2 },
  empty: { color: '#64748b', paddingVertical: 24, textAlign: 'center' },
  error: { color: '#b91c1c' },
  pendingBox: {
    borderWidth: 1,
    borderColor: '#fcd34d',
    backgroundColor: '#fffbeb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  pendingTitle: { fontWeight: '700', color: '#92400e' },
  pendingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingName: { color: '#0f172a' },
});
