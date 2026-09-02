import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, UnauthorizedError } from "./api/client";
import type { CurrentUser } from "./api/types";

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** True when the user may see chats of at least one group. */
  canUseChats: boolean;
  /** Metrics dashboard and operator leaderboard - managers and admins only. */
  canViewMetrics: boolean;
  /** Excel export - managers and admins only. */
  canExport: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Holds the signed-in user. The session lives in an HttpOnly cookie, so the
 * app asks the backend who it is on start rather than trusting local storage.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  const login = useCallback(async (username: string, password: string) => {
    setUser(await api.login(username, password));
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    // Drop every cached answer: the next user must not see the previous one's data.
    window.location.href = "/";
  }, []);

  const value = useMemo<AuthState>(() => {
    // Everything beyond the two statistics screens is a role decision, not a
    // grant one: the backend refuses those endpoints outright for `user`.
    const privileged = user !== null && user.role !== "user";
    return {
      user,
      loading,
      login,
      logout,
      canUseChats: user !== null && privileged && (user.unrestricted || user.chatGroups.length > 0),
      canViewMetrics: privileged,
      canExport: privileged,
    };
  }, [user, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth вне AuthProvider");
  }
  return ctx;
}
