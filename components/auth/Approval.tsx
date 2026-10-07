"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WAITING_NOTE } from "@/lib/auth/approval";

/**
 * Whether this account may use what costs money, for client components that
 * need to disable a button. The server decides (app/layout.tsx reads the
 * profile); this only carries the answer down. The paid routes check again
 * themselves with requireApprovedUser, so a page that gets this wrong cannot
 * spend anything.
 *
 * true unless the account is known to be waiting. An account whose profile
 * could not be read is left enabled here and refused by the route, which says why.
 */
const ApprovedContext = createContext<boolean>(true);

export function ApprovalProvider({ approved, children }: { approved: boolean; children: ReactNode }) {
  return <ApprovedContext.Provider value={approved}>{children}</ApprovedContext.Provider>;
}

/** False while the account waits for approval: disable anything that calls Anthropic or Deepgram. */
export function useApproved(): boolean {
  return useContext(ApprovedContext);
}

/** The note beside a disabled button. Renders nothing once approved. */
export function WaitingNote({ className = "" }: { className?: string }) {
  const approved = useApproved();
  if (approved) return null;
  return <p className={`text-sm font-semibold text-amber-700 ${className}`}>{WAITING_NOTE}</p>;
}
