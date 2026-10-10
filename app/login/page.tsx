import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { PasscodeForm } from "@/components/auth/PasscodeForm";
import { getViewer } from "@/lib/server/auth";
import { testrunEnabled } from "@/lib/server/testrunAccess";
import { HOME_PATH } from "@/lib/ui/nav";

export const metadata: Metadata = { title: "Sign in" };

// Why a sign-in attempt was bounced back here. Kept short and in one place so
// the routes that redirect and the sentence shown never drift apart.
const NOTICES: Record<string, string> = {
  link: "That link didn't work. It may have been used already or expired.",
  recovery: "That reset link has expired. Ask for a new one.",
};

// Typed by hand rather than with PageProps, which only exists once `next build`
// has generated route types, so `tsc` on a fresh clone would fail.
type LoginProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Login({ searchParams }: LoginProps) {
  const viewer = await getViewer();
  if (viewer.status === "approved" || viewer.status === "waiting") redirect(HOME_PATH);

  const { error, mode } = await searchParams;
  const notice = typeof error === "string" ? (NOTICES[error] ?? null) : null;

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] flex-col items-center gap-4 bg-surface-2 px-4 pt-16">
      {testrunEnabled() ? <PasscodeForm /> : <LoginForm notice={notice} initialMode={mode === "signup" ? "signup" : "signin"} />}
      <nav aria-label="Site" className="flex gap-4 text-[12px]">
        <Link href="/" className="text-accent hover:underline">
          About
        </Link>
        <Link href="/privacy" className="text-accent hover:underline">
          Privacy
        </Link>
        <Link href="/terms" className="text-accent hover:underline">
          Terms
        </Link>
        <Link href="/contact" className="text-accent hover:underline">
          Contact
        </Link>
      </nav>
    </main>
  );
}
