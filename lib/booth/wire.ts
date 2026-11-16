// =============================================================================
// Booth partners (Nov 15): what passes between the laptops in one booth, as
// the browser sends it and the server relays it. Pure, imported by both.
//
// PRIVACY: a card event is roster player ids (roster_players.id, uuids), a
// view and a kind. Never a name, a jersey, a word heard or a transcript. The
// server stamps who sent it (a slot: 0 the host, 1 and 2 the guests) from the
// session and never trusts one from the body, relays it at once and keeps
// nothing (lib/server/boothBus.ts).
// =============================================================================

export type CardView = "scoring" | "facts";

/** 0 is the host, 1 and 2 the guests. */
export type BoothSlot = 0 | 1 | 2;

/**
 * One thing a laptop's own engine did to its own screen, worth the others
 * knowing: players went up (fired, or a number narrowed a card to another
 * player), came down because the final result took them back, or a scoring
 * word turned a card. A takedown (X, 1 to 3) is never sent: it is one
 * screen's correction.
 */
export type CardEvent =
  | { kind: "up"; ids: string[]; views: CardView[] }
  | { kind: "down"; ids: string[] }
  | { kind: "view"; ids: string[]; view: CardView };

/** What a laptop may post: a card event, or (the host only) that he refreshed the rosters. */
export type BoothPost = CardEvent | { kind: "refresh" };

/** At most this many players in one event: the engine shows three. */
export const MAX_EVENT_IDS = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_EVENT_IDS &&
    value.every((id) => typeof id === "string" && UUID.test(id)) &&
    new Set(value).size === value.length
  );
}

function isView(value: unknown): value is CardView {
  return value === "scoring" || value === "facts";
}

/** A post body exactly as allowed, nothing else in it. */
export function isBoothPost(body: unknown): body is BoothPost {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(",");
  switch (value.kind) {
    case "up":
      return keys === "ids,kind,views" && isIds(value.ids) && Array.isArray(value.views) && value.views.length === value.ids.length && value.views.every(isView);
    case "down":
      return keys === "ids,kind" && isIds(value.ids);
    case "view":
      return keys === "ids,kind,view" && isIds(value.ids) && isView(value.view);
    case "refresh":
      return keys === "kind";
    default:
      return false;
  }
}

/** Who is in the booth, by slot, and whether each has the live connection open. No names. */
export interface MemberState {
  slot: BoothSlot;
  online: boolean;
}

/** What the server sends down the live connection. */
export type BoothMessage =
  | { type: "hello"; you: BoothSlot; members: MemberState[] }
  | { type: "members"; members: MemberState[] }
  | ({ type: "card"; from: BoothSlot } & CardEvent)
  | { type: "refresh"; from: BoothSlot }
  /** The host ended the game: every guest's game ends too. */
  | { type: "ended" }
  /** This guest was taken out of the booth by the host. */
  | { type: "removed" };

function isSlot(value: unknown): value is BoothSlot {
  return value === 0 || value === 1 || value === 2;
}

function isMembers(value: unknown): value is MemberState[] {
  return (
    Array.isArray(value) &&
    value.every((m) => typeof m === "object" && m !== null && isSlot((m as MemberState).slot) && typeof (m as MemberState).online === "boolean")
  );
}

/** A message off the wire, trusted only once it reads as one. */
export function readBoothMessage(text: string): BoothMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case "hello":
      return isSlot(m.you) && isMembers(m.members) ? { type: "hello", you: m.you, members: m.members } : null;
    case "members":
      return isMembers(m.members) ? { type: "members", members: m.members } : null;
    case "refresh":
      return isSlot(m.from) ? { type: "refresh", from: m.from } : null;
    case "ended":
      return { type: "ended" };
    case "removed":
      return { type: "removed" };
    case "card": {
      if (!isSlot(m.from)) return null;
      const event = { kind: m.kind, ids: m.ids, ...(m.kind === "up" ? { views: m.views } : {}), ...(m.kind === "view" ? { view: m.view } : {}) };
      return isBoothPost(event) && event.kind !== "refresh" ? ({ type: "card", from: m.from, ...(event as CardEvent) } as BoothMessage) : null;
    }
    default:
      return null;
  }
}
