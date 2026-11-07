import { messages } from "./messages";
import type { LoginBody, RegisterBody } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export type RegistrationValues = RegisterBody & {
  confirmPassword: string;
};

export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return messages.nameRequired;
  if (trimmed.length > 100) return messages.nameMax;
  if ([...trimmed].some((character) => character.charCodeAt(0) < 32)) return messages.nameInvalid;
  return null;
}

export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return messages.emailRequired;
  if (trimmed.length > 254) return messages.emailMax;
  if (!EMAIL_PATTERN.test(trimmed)) return messages.emailInvalid;
  return null;
}

/** Length is the raw string. Passwords are never trimmed. */
export function validatePassword(password: string): string | null {
  if (password.length === 0) return messages.passwordRequired;
  if (password.length < 8) return messages.passwordMin;
  if (password.length > 128) return messages.passwordMax;
  return null;
}

export function validateConfirmPassword(password: string, confirmPassword: string): string | null {
  if (confirmPassword.length === 0) return messages.confirmRequired;
  if (confirmPassword !== password) return messages.confirmMismatch;
  return null;
}

export function validateRegistration(
  values: RegistrationValues,
): Partial<Record<keyof RegistrationValues, string>> {
  const errors: Partial<Record<keyof RegistrationValues, string>> = {};
  const name = validateName(values.name);
  const email = validateEmail(values.email);
  const password = validatePassword(values.password);
  const confirmPassword = validateConfirmPassword(values.password, values.confirmPassword);
  if (name) errors.name = name;
  if (email) errors.email = email;
  if (password) errors.password = password;
  if (confirmPassword) errors.confirmPassword = confirmPassword;
  return errors;
}

export function validateLogin(values: LoginBody): Partial<Record<keyof LoginBody, string>> {
  const errors: Partial<Record<keyof LoginBody, string>> = {};
  const email = validateEmail(values.email);
  const password = validatePassword(values.password);
  if (email) errors.email = email;
  if (password) errors.password = password;
  return errors;
}
