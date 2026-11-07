import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuthApiError, isAbortError } from "./errors";
import { messages } from "./messages";
import { presentAuthError } from "./presentError";
import type { AuthClient, LoginBody, RegisterBody, RequestOptions, User } from "./types";
import { AuthContext, type AuthStatus } from "./auth-context";

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const generation = useRef(0);
  const operation = useRef(0);
  const alive = useRef(true);
  const inflight = useRef<AbortController | null>(null);

  const slowOptions = useCallback((): RequestOptions => {
    const operationId = ++operation.current;
    setSlow(false);
    return {
      onSlow: () => {
        if (alive.current && operation.current === operationId) setSlow(true);
      },
    };
  }, []);

  const finishSlow = useCallback((operationId: number) => {
    if (operation.current !== operationId) return;
    operation.current += 1;
    if (alive.current) setSlow(false);
  }, []);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const generationId = ++generation.current;
    const pace = slowOptions();
    const operationId = operation.current;
    setStatus("loading");
    try {
      const nextUser = await client.me({ signal: controller.signal, onSlow: pace.onSlow });
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
    } finally {
      finishSlow(operationId);
    }
  }, [client, finishSlow, slowOptions]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
    return () => inflight.current?.abort();
  }, [refresh]);

  const register = useCallback(
    async (input: RegisterBody) => {
      const pace = slowOptions();
      const operationId = operation.current;
      try {
        const nextUser = await client.register(input, { onSlow: pace.onSlow });
        setUser(nextUser);
        setHydrationError(null);
        setStatus("authenticated");
      } finally {
        finishSlow(operationId);
      }
    },
    [client, finishSlow, slowOptions],
  );

  const login = useCallback(
    async (input: LoginBody) => {
      const pace = slowOptions();
      const operationId = operation.current;
      try {
        const nextUser = await client.login(input, { onSlow: pace.onSlow });
        setUser(nextUser);
        setHydrationError(null);
        setStatus("authenticated");
      } finally {
        finishSlow(operationId);
      }
    },
    [client, finishSlow, slowOptions],
  );

  const logout = useCallback(async () => {
    const pace = slowOptions();
    const operationId = operation.current;
    try {
      await client.logout({ onSlow: pace.onSlow });
      setUser(null);
      setHydrationError(null);
      setStatus("anonymous");
    } finally {
      finishSlow(operationId);
    }
  }, [client, finishSlow, slowOptions]);

  const value = useMemo(
    () => ({ status, user, hydrationError, slow, register, login, logout, refresh }),
    [status, user, hydrationError, slow, register, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
