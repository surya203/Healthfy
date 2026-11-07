import { Page } from "../components/Page";

export function SessionStatus({ label, detail }: { label: string; detail?: string | null }) {
  return (
    <Page title="Healthify">
      <h1 id="page-title" tabIndex={-1}>
        Healthify
      </h1>
      <p className="lead" role="status" aria-live="polite">
        {label}
      </p>
      {detail ? (
        <p className="status-note" role="status">
          {detail}
        </p>
      ) : null}
    </Page>
  );
}

export function SessionProblem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Page title="Session check failed · Healthify">
      <h1 id="page-title" tabIndex={-1}>
        Session check failed
      </h1>
      <p className="banner" role="alert">
        {message}
      </p>
      <button className="button" type="button" onClick={onRetry}>
        Try again
      </button>
    </Page>
  );
}
