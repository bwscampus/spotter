import type { ReactNode } from "react";
import { PublicFooter } from "@/components/PublicFooter";

/**
 * A plain reading page: privacy, terms, contact. One readable column in the
 * dashboard's type, a title, the date it last changed, then the text.
 */
export function PublicPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <div className="dash flex min-h-[calc(100dvh-40px)] flex-col bg-surface">
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-4 py-10">
        <h1 className="text-[24px] font-bold text-ink">{title}</h1>
        {updated && <p className="text-[12px] text-muted">Last updated {updated}</p>}
        <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink [&_a]:text-accent [&_a:hover]:underline [&_h2]:pt-2 [&_h2]:text-[17px] [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1">
          {children}
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
