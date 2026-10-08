import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Page not found" };

/** A link that goes nowhere, or a team or game that is not this account's. */
export default function NotFound() {
  return (
    <main className="dash flex min-h-[60dvh] items-start justify-center bg-surface px-4 pt-16">
      <div className="flex w-full max-w-[420px] flex-col gap-3 rounded-[3px] border border-line bg-surface p-5">
        <p className="font-num text-[12px] text-muted">404</p>
        <h1 className="text-[15px] font-semibold text-ink">Page not found</h1>
        <p className="text-[13px] text-ink-2">There is nothing at this address. It may have moved, or it may belong to another account.</p>
        <Link href="/" className={`${buttonClass("outlined")} self-start`}>
          Home
        </Link>
      </div>
    </main>
  );
}
