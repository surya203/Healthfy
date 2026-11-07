import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { FormStatus, TextField } from "./TextField";

export type AuthField = {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  hint?: string;
  spellCheck?: boolean;
  autoCapitalize?: "none" | "words";
};

type AuthFormProps = {
  title: string;
  lead: string;
  fields: AuthField[];
  values: Record<string, string>;
  errors: Partial<Record<string, string>>;
  banner: string | null;
  pending: boolean;
  pendingMessage: string;
  submitLabel: string;
  pendingLabel: string;
  focusTarget: string | null;
  focusToken: number;
  onChange: (name: string, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  footer: ReactNode;
};

export function AuthForm({
  title,
  lead,
  fields,
  values,
  errors,
  banner,
  pending,
  pendingMessage,
  submitLabel,
  pendingLabel,
  focusTarget,
  focusToken,
  onChange,
  onSubmit,
  footer,
}: AuthFormProps) {
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget === "banner") {
      bannerRef.current?.focus();
      return;
    }
    const field = document.getElementById(focusTarget);
    if (field instanceof HTMLElement) field.focus();
  }, [focusTarget, focusToken]);

  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {title}
      </h1>
      <p className="lead">{lead}</p>
      <form method="post" noValidate aria-busy={pending || undefined} onSubmit={onSubmit}>
        <FormStatus>{pending ? pendingMessage : ""}</FormStatus>
        {banner ? (
          <div id="form-error" ref={bannerRef} tabIndex={-1} className="banner" role="alert">
            {banner}
          </div>
        ) : null}
        {fields.map((field) => (
          <TextField
            key={field.id}
            {...field}
            value={values[field.name] ?? ""}
            error={errors[field.name]}
            disabled={pending}
            onChange={(value) => onChange(field.name, value)}
          />
        ))}
        <button className="button" type="submit" disabled={pending} aria-busy={pending || undefined}>
          {pending ? pendingLabel : submitLabel}
        </button>
      </form>
      <p className="switch">{footer}</p>
    </>
  );
}
