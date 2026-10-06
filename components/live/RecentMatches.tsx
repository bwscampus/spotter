"use client";

import type { RecentMatch } from "@/lib/matching/SpotterEngine";

function clockTime(ms: number) {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function RecentMatches({ matches }: { matches: RecentMatch[] }) {
  return (
    <div className="flex shrink-0 flex-col gap-1" data-testid="recent-matches">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">Last matches</span>
      <ol className="flex h-5 items-baseline gap-5 text-sm">
        {matches.length === 0 && <li className="text-neutral-400">None yet</li>}
        {matches.map((match, i) => (
          <li
            key={`${match.wallTime}-${match.name}`}
            title={`"${match.word}" · score ${match.score.toFixed(2)}`}
            className={`flex items-baseline gap-2 ${i === 0 ? "text-neutral-900" : "text-neutral-500"}`}
          >
            <span className="font-mono text-xs tabular-nums">{clockTime(match.wallTime)}</span>
            <span className="font-black uppercase">{match.name}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
