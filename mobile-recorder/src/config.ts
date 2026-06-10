import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const STORAGE_KEY = 'janushc:apiBaseUrl';

const DEFAULT_API_BASE_URL =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'http://localhost:8080';

export const googleWebClientId =
  (Constants.expoConfig?.extra?.googleWebClientId as string | undefined) ?? '';

export async function loadApiBaseUrl(): Promise<string> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY).catch(() => null);
  return (stored && stored.trim()) || DEFAULT_API_BASE_URL;
}

export async function saveApiBaseUrl(value: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, value).catch(() => undefined);
}

export function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
