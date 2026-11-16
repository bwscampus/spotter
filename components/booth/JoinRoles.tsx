"use client";

import { useState, type ReactNode } from "react";
import { AboutYou } from "@/components/onboarding/AboutYou";

/** Booth partners (Nov 15): an invited new account's one question, then what the invite is. */
export function JoinRoles({ needsRoles, children }: { needsRoles: boolean; children: ReactNode }) {
  const [ask, setAsk] = useState(needsRoles);
  if (!ask) return <>{children}</>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-2">One question first.</p>
      <AboutYou initial={{ sports: [], roles: [] }} mode="booth" onDone={() => setAsk(false)} />
    </div>
  );
}
