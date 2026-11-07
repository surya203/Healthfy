import { useState, type FormEvent } from "react";
import { isAbortError } from "./errors";
import { presentAuthError } from "./presentError";

function valuesFromForm<T extends Record<string, string>>(form: HTMLFormElement, current: T): T {
  const data = new FormData(form);
  const next = { ...current };
  for (const key of Object.keys(current) as (keyof T)[]) {
    const entry = data.get(String(key));
    if (typeof entry === "string") next[key] = entry as T[keyof T];
  }
  return next;
}

function focusTargetFor(errors: Partial<Record<string, string>>, banner: string | null): string | null {
  const field = Object.entries(errors).find(([, message]) => Boolean(message))?.[0];
  return field ?? (banner ? "banner" : null);
}

export function useAuthForm<T extends Record<string, string>>(
  initial: T,
  validate: (values: T) => Partial<Record<keyof T, string>>,
  submit: (values: T) => Promise<void>,
) {
  const [values, setValues] = useState(initial);
  const [clientErrors, setClientErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  function moveFocus(errors: Partial<Record<string, string>>, nextBanner: string | null) {
    setFocusTarget(focusTargetFor(errors, nextBanner));
    setFocusToken((token) => token + 1);
  }

  function onChange(name: string, value: string) {
    if (!(name in values)) return;
    const key = name as keyof T;
    const next = { ...values, [key]: value };
    setValues(next);
    setBanner(null);
    setServerErrors((current) => {
      if (!current[key]) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
    if (submitted) setClientErrors(validate(next));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextValues = valuesFromForm(event.currentTarget, values);
    setValues(nextValues);
    setSubmitted(true);
    setBanner(null);
    setServerErrors({});
    const nextClientErrors = validate(nextValues);
    setClientErrors(nextClientErrors);
    if (Object.values(nextClientErrors).some(Boolean)) {
      moveFocus(nextClientErrors, null);
      return;
    }
    setPending(true);
    try {
      await submit(nextValues);
    } catch (error) {
      if (isAbortError(error)) return;
      const presented = presentAuthError(error);
      const fields = (presented.fields ?? {}) as Partial<Record<keyof T, string>>;
      setServerErrors(fields);
      setBanner(presented.banner ?? null);
      moveFocus(fields, presented.banner ?? null);
    } finally {
      setPending(false);
    }
  }

  const errors: Partial<Record<keyof T, string>> = { ...clientErrors, ...serverErrors };

  return { values, errors, banner, pending, onChange, onSubmit, focusTarget, focusToken };
}
