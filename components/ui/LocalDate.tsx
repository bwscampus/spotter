"use client";

import { useSyncExternalStore } from "react";
import { shortDate } from "@/lib/ui/format";

const subscribe = () => () => undefined;

/** True once in the browser, false while the server renders. */
export function useInBrowser(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * "Oct 3, 9:12 PM" in the announcer's own time zone. Written only in the
 * browser, because the server does not know that time zone; the server leaves
 * the cell empty rather than send a wrong time.
 */
export function LocalDate({ iso, className = "font-num text-[12px]" }: { iso: string; className?: string }) {
  const inBrowser = useInBrowser();
  return (
    <time dateTime={iso} className={className}>
      {inBrowser ? shortDate(iso) : ""}
    </time>
  );
}
