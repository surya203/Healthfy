import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { useAuthForm } from "../auth/useAuthForm";
import { validateRegistration } from "../auth/validation";
import { AuthForm } from "../components/AuthForm";
import { Page } from "../components/Page";

export function RegisterPage() {
  const { register, hydrationError } = useAuth();
  const form = useAuthForm(
    { name: "", email: "", password: "", confirmPassword: "" },
    validateRegistration,
    async (values) => {
      await register({ name: values.name, email: values.email, password: values.password });
    },
  );

  return (
    <Page title="Create account · Healthify">
      <AuthForm
        title="Create your account"
        lead="Create an account to use Healthify."
        fields={[
          {
            id: "name",
            name: "name",
            label: "Name",
            type: "text",
            autoComplete: "name",
            autoCapitalize: "words",
          },
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
            autoComplete: "new-password",
            autoCapitalize: "none",
            spellCheck: false,
            hint: "8–128 characters. Spaces at the start or end are kept.",
          },
          {
            id: "confirmPassword",
            name: "confirmPassword",
            label: "Confirm password",
            type: "password",
            autoComplete: "new-password",
            autoCapitalize: "none",
            spellCheck: false,
            hint: "Re-enter the password exactly. This check stays in the browser.",
          },
        ]}
        values={form.values}
        errors={form.errors}
        banner={form.banner ?? hydrationError}
        pending={form.pending}
        pendingMessage="Creating your account…"
        submitLabel="Create account"
        pendingLabel="Creating account…"
        focusTarget={form.focusTarget}
        focusToken={form.focusToken}
        onChange={(name, value) => form.onChange(name, value)}
        onSubmit={form.onSubmit}
        footer={
          <>
            Already have an account? <Link to="/login">Sign in</Link>
          </>
        }
      />
    </Page>
  );
}
