import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Department, Encounter, listDepartments, listEncounters } from '../api';
import { useAuth } from '../auth';

export function PickEncounterScreen({ onSelect }: { onSelect: (e: Encounter) => void }) {
  const { token, baseUrl, signOut } = useAuth();
  const opts = useMemo(() => ({ baseUrl, token, onUnauthorized: signOut }), [baseUrl, token, signOut]);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
});
