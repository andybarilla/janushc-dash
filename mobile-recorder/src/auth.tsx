import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { googleLogin } from './api';
import { googleWebClientId, loadApiBaseUrl } from './config';

const JWT_KEY = 'janushc:jwt';

type AuthState = {
  ready: boolean;
  token: string | null;
  baseUrl: string;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('http://localhost:8080');

  useEffect(() => {
    GoogleSignin.configure({ webClientId: googleWebClientId });
    Promise.all([
      AsyncStorage.getItem(JWT_KEY).catch(() => null),
      loadApiBaseUrl(),
    ]).then(([storedToken, storedBase]) => {
      if (storedToken) setToken(storedToken);
      setBaseUrl(storedBase);
      setReady(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      baseUrl,
      async signIn() {
        await GoogleSignin.hasPlayServices();
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo.data?.idToken;
        if (!idToken) throw new Error('no idToken returned from Google');
        const jwt = await googleLogin(baseUrl, idToken);
        await AsyncStorage.setItem(JWT_KEY, jwt);
        setToken(jwt);
      },
      signOut() {
        AsyncStorage.removeItem(JWT_KEY).catch(() => undefined);
        GoogleSignin.signOut().catch(() => undefined);
        setToken(null);
      },
    }),
    [ready, token, baseUrl],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
