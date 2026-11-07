import { createContext, useContext } from "react";
import type { LoginBody, RegisterBody, User } from "./types";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "error";

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  hydrationError: string | null;
  slow: boolean;
  register: (input: RegisterBody) => Promise<void>;
  login: (input: LoginBody) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
