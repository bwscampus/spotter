import type { BoothMessage, BoothPost, BoothSlot, MemberState } from "@/lib/booth/wire";

// =============================================================================
// Booth partners (Nov 15): what the live screen is handed to hear and tell
// its partners, the way it is handed live stats. The network side
// (lib/booth/link.ts) is built in the live page's composition root and never
// imported by the card path: LiveScreen only calls these.
// =============================================================================

export type BoothLinkStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface BoothState {
  status: BoothLinkStatus;
  /** This laptop's slot, once the server said hello. */
  you: BoothSlot | null;
  members: MemberState[];
}

export interface BoothBridge {
  role: "host" | "guest";
  /** The booth's id: the host's game. */
  gameId: string;
  /** Tells the partners. Called after paint only; never blocks, never throws. */
  send(post: BoothPost): void;
  /** Hears the partners. Returns how to stop. */
  listen(handler: (message: BoothMessage) => void): () => void;
  /** The connection and who is in, for the top bar. */
  state(): BoothState;
  subscribe(onChange: () => void): () => void;
}
