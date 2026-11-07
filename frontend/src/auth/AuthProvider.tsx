import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthApiError, isAbortError } from "./errors";
import { messages } from "./messages";
import { presentAuthError } from "./presentError";
import type { AuthClient, LoginBody, RegisterBody, User } from "./types";
import { AuthContext, type AuthStatus } from "./auth-context";

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const generation = useRef(0);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const generationId = ++generation.current;
    setStatus("loading");
    try {
      const nextUser = await client.me({ signal: controller.signal });
      if (generationId !== generation.current) return;
      setUser(nextUser);
      setHydrationError(null);
      setStatus("authenticated");
    } catch (error) {
      if (generationId !== generation.current || isAbortError(error)) return;
      if (error instanceof AuthApiError && error.status === 401) {
        setUser(null);
        setHydrationError(null);
        setStatus("anonymous");
        return;
      }
      setUser(null);
      setHydrationError(presentAuthError(error).banner ?? messages.generic);
      setStatus("error");
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  const register = useCallback(
    async (input: RegisterBody) => {
      const nextUser = await client.register(input);
      setUser(nextUser);
      setHydrationError(null);
      setStatus("authenticated");
    },
    [client],
  );

  const login = useCallback(
    async (input: LoginBody) => {
      const nextUser = await client.login(input);
      setUser(nextUser);
      setHydrationError(null);
      setStatus("authenticated");
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setUser(null);
    setHydrationError(null);
    setStatus("anonymous");
  }, [client]);

  const value = useMemo(
    () => ({ status, user, hydrationError, register, login, logout, refresh }),
    [status, user, hydrationError, register, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
