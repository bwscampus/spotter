"use client";

import { useSyncExternalStore } from "react";
import {
  BLOCKER_WORDS,
  browserSupport,
  CAUTION_WORDS,
  IN_APP_LINE,
  NEEDS_LINE,
  readBrowserFacts,
  type BrowserSupport,
} from "@/lib/game/browserSupport";

// =============================================================================
// The box that says this browser cannot call a game, and why (pre-launch audit
// H13). On the live screen before Listen and on game setup; exported so any
// other page can show it too. Renders nothing on the server and nothing when
// the browser has everything.
// =============================================================================

// Read once per page load: none of it changes while the page is open.
let cached: BrowserSupport | null = null;

function readSupport(): BrowserSupport {
  cached ??= browserSupport(readBrowserFacts());
  return cached;
}

const noSubscription = () => () => undefined;

/** What this browser is missing, or null on the server and before the page has mounted. */
export function useBrowserSupport(): BrowserSupport | null {
  return useSyncExternalStore(noSubscription, readSupport, () => null);
}

const LOOKS = {
  live: {
    blocked: "border-b border-red-300 bg-red-50 px-6 py-3 text-red-800",
    caution: "border-b border-amber-300 bg-amber-50 px-6 py-2 text-amber-800",
    lead: "text-lg font-black",
    item: "text-base font-semibold",
  },
  dash: {
    blocked: "rounded-[3px] border border-red-line bg-red-fill px-3 py-2 text-red",
    caution: "rounded-[3px] border border-amber-line bg-amber-fill px-3 py-2 text-amber-text",
    lead: "font-semibold",
    item: "text-[13px]",
  },
} as const;

export function BrowserCheck({ look = "live", className = "" }: { look?: "live" | "dash"; className?: string }) {
  const support = useBrowserSupport();
  if (!support) return null;
  const { blockers, cautions, inApp } = support;
  if (blockers.length === 0 && cautions.length === 0) return null;
  const style = LOOKS[look];

  if (blockers.length === 0) {
    return (
      <div role="status" data-testid="browser-check" className={`${style.caution} ${className}`}>
        {cautions.map((caution) => (
          <p key={caution} className={style.item}>
            {CAUTION_WORDS[caution]}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div role="alert" data-testid="browser-check" className={`${style.blocked} ${className}`}>
      <p className={style.lead}>{NEEDS_LINE}</p>
      {inApp && <p className={style.lead}>{IN_APP_LINE}</p>}
      <ul className="mt-1 flex flex-col gap-0.5">
        {blockers.map((blocker) => (
          <li key={blocker} className={style.item}>
            {blocker === "in_app_browser" && inApp ? `This is ${inApp}'s built-in browser.` : BLOCKER_WORDS[blocker]}
          </li>
        ))}
      </ul>
    </div>
  );
}
