import { useState } from "react";
import { useAuth } from "../auth/auth-context";
import { isAbortError } from "../auth/errors";
import { formatCreatedAt } from "../auth/format";
import { messages } from "../auth/messages";
import { presentAuthError } from "../auth/presentError";
import { Page } from "../components/Page";

export function HomePage() {
  const { user, logout } = useAuth();
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (!user) return null;

  async function onLogout() {
    setPending(true);
    setBanner(null);
    try {
      await logout();
    } catch (error) {
      if (!isAbortError(error)) {
        setBanner(presentAuthError(error).banner ?? messages.generic);
        setPending(false);
      }
    }
  }

  return (
    <Page title="Home · Healthify">
      <h1 id="page-title" tabIndex={-1}>
        Welcome, {user.name}
      </h1>
      <p className="lead">You're signed in.</p>
      {banner ? (
        <p className="banner" role="alert">
          {banner}
        </p>
      ) : null}
      <dl className="account">
        <div>
          <dt>Name</dt>
          <dd>{user.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>Member since</dt>
          <dd>
            <time dateTime={user.created_at}>{formatCreatedAt(user.created_at)}</time>
          </dd>
        </div>
      </dl>
      <button className="button button-secondary" type="button" onClick={() => void onLogout()} disabled={pending}>
        {pending ? "Logging out…" : "Log out"}
      </button>
      <p className="sr-only" role="status" aria-live="polite">
        {pending ? "Logging out…" : ""}
      </p>
    </Page>
  );
}
