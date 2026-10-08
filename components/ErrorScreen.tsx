"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui/Button";
import { reportError } from "@/lib/errors/report";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/ui/site";

/**
 * What app/error.tsx and app/global-error.tsx show: a plain message, Try
 * again and Home. The error is reported once, with Next's digest, so it can be
 * matched to the server's log.
 */
export function ErrorScreen({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError(error, error.digest);
  }, [error]);

  return (
    <main className="dash flex min-h-[60dvh] items-start justify-center bg-surface px-4 pt-16">
      <div role="alert" className="flex w-full max-w-[420px] flex-col gap-3 rounded-[3px] border border-line bg-surface p-5">
        <h1 className="text-[15px] font-semibold text-ink">Something went wrong</h1>
        <p className="text-[13px] text-ink-2">
          This page hit an error. Try again, or go home. If it keeps happening, email{" "}
          <a href={CONTACT_MAILTO} className="text-accent hover:underline">
            {CONTACT_EMAIL}
          </a>
          {error.digest ? (
            <>
              {" "}
              with the code <span className="font-num">{error.digest}</span>.
            </>
          ) : (
            "."
          )}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
            Try again
          </button>
          <Link href="/" className={buttonClass("outlined")}>
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
