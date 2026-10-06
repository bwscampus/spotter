import { track } from "./track";

/**
 * How close a user's first sign-in has to be to the account's creation to
 * count as signing up. Both times come from Supabase, so the browser's clock
 * does not matter.
 */
const NEW_ACCOUNT_WINDOW_MS = 60_000;

type AuthUser = { created_at?: string | null; last_sign_in_at?: string | null };

/**
 * True when this sign-in created the account. Google sign-in has no separate
 * sign-up step, so a returning user and a new one look the same except here:
 * a new account's last sign-in is its creation.
 */
export function isNewAccount(user: AuthUser | null | undefined): boolean {
  if (!user?.created_at || !user.last_sign_in_at) return false;
  const created = Date.parse(user.created_at);
  const signedIn = Date.parse(user.last_sign_in_at);
  if (!Number.isFinite(created) || !Number.isFinite(signedIn)) return false;
  return Math.abs(signedIn - created) < NEW_ACCOUNT_WINDOW_MS;
}

/**
 * account.signed_up, once per new account. A unique index on app_events keeps
 * it to one row even if this fires twice (a sign-out and back in inside the
 * window), and the events route treats that duplicate as already recorded.
 */
export function recordSignUp(user: AuthUser | null | undefined, method: "google" | "email"): void {
  if (isNewAccount(user)) track("account.signed_up", { method });
}
