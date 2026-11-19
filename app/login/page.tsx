import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/auth/next";
import { readSignupSource } from "@/lib/auth/signupSource";
import { getViewer } from "@/lib/server/auth";
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
  const { error, mode, next: nextParam, from } = await searchParams;
  // Booth partners (Nov 15): an invite opened while signed out comes back to its join step.
  const next = safeNext(nextParam);
  if (viewer.status === "approved" || viewer.status === "waiting") redirect(next ?? HOME_PATH);

  const notice = typeof error === "string" ? (NOTICES[error] ?? null) : null;

  return (
    <main className="dash flex min-h-[calc(100dvh-40px)] flex-col items-center gap-4 bg-surface-2 px-4 pt-16">
      {next && (
        <p className="max-w-[380px] text-center font-semibold" data-testid="booth-invite-note">
          Sign in or make a free account, and you&apos;ll go straight back to your booth invite.
        </p>
      )}
      <LoginForm notice={notice} initialMode={mode === "signup" ? "signup" : "signin"} next={next} from={readSignupSource(from, "login")} />
      <nav aria-label="Site" className="flex gap-4 text-[14px]">
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
