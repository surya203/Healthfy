import { Page } from "../components/Page";

export function SessionStatus({ label }: { label: string }) {
  return (
    <Page title="Healthify">
      <h1 id="page-title" tabIndex={-1}>
        Healthify
      </h1>
      <p className="lead" role="status" aria-live="polite">
        {label}
      </p>
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
