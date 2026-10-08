import { cache } from "react";
import { getViewer } from "@/lib/server/auth";
import { queryOne } from "@/lib/server/db";

// V3's viewer helpers (same names, so V3's pages port unchanged), read from
// this app's session (lib/server/auth.ts) rather than Supabase's claims. For
// showing and hiding things only: every paid route checks for itself.

/** The signed-in account's id, or null when signed out (or when it cannot be read). */
export const getViewerId = cache(async (): Promise<string | null> => {
  const viewer = await getViewer();
  return viewer.user?.id ?? null;
});

/**
 * Whether the signed-in account has said it has the right to use what it
 * uploads (users.accepted_upload_terms_at, V3 audit M5). False when signed out
 * or when it cannot be read: the import then asks again.
 */
export const getUploadTermsAccepted = cache(async (): Promise<boolean> => {
  const id = await getViewerId();
  if (!id) return false;
  try {
    const row = await queryOne<{ accepted: boolean }>("select accepted_upload_terms_at is not null as accepted from users where id = $1", [id]);
    return row?.accepted ?? false;
  } catch {
    return false;
  }
});

/** The signed-in account's email for the header, or null when signed out. */
export const getViewerEmail = cache(async (): Promise<string | null> => {
  const viewer = await getViewer();
  return viewer.user ? viewer.user.email : null;
});

/** False only for a signed-in email/password account that has not confirmed its address yet. */
export const getViewerEmailConfirmed = cache(async (): Promise<boolean> => {
  const viewer = await getViewer();
  return viewer.user ? viewer.user.emailVerified : true;
});
