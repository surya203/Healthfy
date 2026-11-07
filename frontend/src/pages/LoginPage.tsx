import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { useAuthForm } from "../auth/useAuthForm";
import { validateLogin } from "../auth/validation";
import { AuthForm } from "../components/AuthForm";
import { Page } from "../components/Page";

export function LoginPage() {
  const { login, hydrationError, slow } = useAuth();
  const form = useAuthForm({ email: "", password: "" }, validateLogin, async (values) => {
    await login(values);
  });

  return (
    <Page title="Sign in · Healthify">
      <AuthForm
        title="Sign in"
        lead="Welcome back."
        fields={[
          {
            id: "email",
            name: "email",
            label: "Email",
            type: "email",
            autoComplete: "email",
            autoCapitalize: "none",
            spellCheck: false,
          },
          {
            id: "password",
            name: "password",
            label: "Password",
            type: "password",
            autoComplete: "current-password",
            autoCapitalize: "none",
            spellCheck: false,
            hint: "8–128 characters. Spaces at the start or end are kept.",
          },
        ]}
        values={form.values}
        errors={form.errors}
        banner={form.banner ?? hydrationError}
        pending={form.pending}
        pendingMessage="Signing in…"
        submitLabel="Sign in"
        pendingLabel="Signing in…"
        focusTarget={form.focusTarget}
        focusToken={form.focusToken}
        slow={slow}
        onChange={(name, value) => form.onChange(name, value)}
        onSubmit={form.onSubmit}
        footer={
          <>
            New to Healthify? <Link to="/register">Create an account</Link>
          </>
        }
      />
    </Page>
  );
}
