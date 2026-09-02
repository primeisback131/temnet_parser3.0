import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, SESSION_EXPIRED_EVENT, UnauthorizedError } from "./api/client";
import type { CurrentUser } from "./api/types";

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /** The last session ended on its own (expired or the account was disabled). */
  sessionExpired: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads who the user is — after a password change, for instance. */
  refresh: () => Promise<void>;
  /** True when the user may see chats of at least one group. */
  canUseChats: boolean;
  /** Metrics dashboard and operator leaderboard — managers and admins only. */
  canViewMetrics: boolean;
  /** Excel export — managers and admins only. */
  canExport: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the signed-in user. The session lives in an HttpOnly cookie, so the
 * app asks the backend who it is on start rather than trusting local storage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof UnauthorizedError)) {
          console.error(e);
        }
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  // The backend answered 401 to a call made for a signed-in user: the session
  // is gone. Drop the user and every cached answer, and say why on the login
  // screen instead of leaving empty tables behind.
  useEffect(() => {
    const onExpired = () => {
      if (userRef.current) {
        setSessionExpired(true);
      }
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [queryClient]);

  const login = useCallback(async (username: string, password: string) => {
    const signedIn = await api.login(username, password);
    setSessionExpired(false);
    setUser(signedIn);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (e) {
      // The session may already be gone; the local state is cleared regardless.
      console.error(e);
    }
    setUser(null);
    queryClient.clear();
    // A full reload also resets every page's own state (filters, selections).
    window.location.assign("/");
  }, [queryClient]);

  const refresh = useCallback(async () => {
    setUser(await api.me());
  }, []);

  const value = useMemo<AuthState>(() => {
    // Everything beyond the two statistics screens is a role decision, not a
    // grant one: the backend refuses those endpoints outright for `user`.
    const privileged = user !== null && user.role !== "user";
    return {
      user,
      loading,
      sessionExpired,
      login,
      logout,
      refresh,
      canUseChats: user !== null && privileged && (user.unrestricted || user.chatGroups.length > 0),
      canViewMetrics: privileged,
      canExport: privileged,
    };
  }, [user, loading, sessionExpired, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth вне AuthProvider");
  }
  return ctx;
}
