import type { ReactNode } from "react";

type TextFieldProps = {
  id: string;
  name: string;
  label: string;
  type: "text" | "email" | "password";
  value: string;
  hint?: string;
  error?: string;
  autoComplete: string;
  disabled?: boolean;
  spellCheck?: boolean;
  autoCapitalize?: "none" | "words";
  onChange: (value: string) => void;
};

export function TextField({
  id,
  name,
  label,
  type,
  value,
  hint,
  error,
  autoComplete,
  disabled,
  spellCheck,
  autoCapitalize,
  onChange,
}: TextFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        spellCheck={spellCheck}
        required
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <p id={errorId} className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormStatus({ children }: { children: ReactNode }) {
  return (
    <p className="sr-only" role="status" aria-live="polite">
      {children}
    </p>
  );
}
