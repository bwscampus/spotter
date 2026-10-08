"use client";

import { useSyncExternalStore } from "react";
import { todayIso } from "@/lib/stats/review";

const subscribe = () => () => undefined;

/**
 * Today in the announcer's own time zone, "YYYY-MM-DD", or null while the
 * server renders: how old a team's stats are is the browser's to say, because
 * the server does not know the announcer's time zone.
 */
export function useToday(): string | null {
  return useSyncExternalStore(subscribe, todayIso, () => null);
}
