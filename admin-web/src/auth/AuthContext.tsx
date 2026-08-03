import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import axios from 'axios';
import { API_BASE, api, tokenStore } from '../api/client';
import type { AuthUser } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await axios.post(`${API_BASE}/auth/login`, {
      email: email.trim(),
      password,
    });
    const body = response.data as { accessToken: string; user: AuthUser };
    if (body.user.role !== 'ADMIN') {
      throw new Error('This account does not have admin access');
    }
    tokenStore.set(body.accessToken);
    setUser(body.user);
  }, []);

  const restore = useCallback(async () => {
    if (!tokenStore.get()) {
      setReady(true);
      return;
    }
    try {
      const response = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(response.data.user);
    } catch {
      logout();
    } finally {
      setReady(true);
    }
  }, [logout]);

  const value = useMemo(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout],
  );

  useEffect(() => {
    void restore();
  }, [restore]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
