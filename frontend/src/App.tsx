import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/auth-context";
import { AuthProvider } from "./auth/AuthProvider";
import type { AuthClient } from "./auth/types";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SessionProblem, SessionStatus } from "./pages/SessionState";

function RouteAnnouncer() {
  const { pathname } = useLocation();
  const skip = useRef(true);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    const title = document.getElementById("page-title");
    if (title instanceof HTMLElement) title.focus();
  }, [pathname]);

  return null;
}

function ProtectedRoute() {
  const { status, user, hydrationError, refresh } = useAuth();
  if (status === "loading") return <SessionStatus label="Checking your session…" />;
  if (status === "error") {
    return <SessionProblem message={hydrationError ?? "Unable to check your session."} onRetry={() => void refresh()} />;
  }
  if (status !== "authenticated" || !user) return <Navigate to="/login" replace />;
  return <HomePage />;
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <SessionStatus label="Checking your session…" />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  return children;
}

export function App({ client }: { client: AuthClient }) {
  return (
    <AuthProvider client={client}>
      <div className="app">
        <header className="site-header">
          <p className="wordmark">
            <span className="mark" aria-hidden="true">
              H
            </span>
            Healthify
          </p>
          <a className="skip-link" href="#main">
            Skip to content
          </a>
        </header>
        <RouteAnnouncer />
        <Routes>
          <Route path="/" element={<ProtectedRoute />} />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <LoginPage />
              </GuestRoute>
            }
          />
          <Route
            path="/register"
            element={
              <GuestRoute>
                <RegisterPage />
              </GuestRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </AuthProvider>
  );
}
