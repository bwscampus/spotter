import type { Metadata } from "next";
import Link from "next/link";
import { TEXT_LINK } from "@/components/ui/Button";
import { AUTH_BOX } from "@/components/auth/LoginForm";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password", referrer: "no-referrer" };

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type ResetProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Where a reset link lands (`/reset-password?token=...`). The page does not
 * check the token: the form posts it with the new password, and the server
 * says then whether the link still works, so the link is spent only once.
 */
export default async function ResetPassword({ searchParams }: ResetProps) {
  const { token } = await searchParams;

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] items-start justify-center bg-surface-2 px-4 pt-16">
      {typeof token === "string" && token.length > 0 ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className={AUTH_BOX}>
          <h1 className="text-[15px] font-semibold">Reset your password</h1>
          <p className="text-muted">This page needs the link from a reset email. Ask for one from the sign-in page.</p>
          <Link href="/login" className={`${TEXT_LINK} self-start`}>
            Back to sign in
          </Link>
        </div>
      )}
    </main>
  );
}
