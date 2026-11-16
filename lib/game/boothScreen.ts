import type { BoothSlot, CardEvent, CardView } from "@/lib/booth/wire";
import type { LogRow } from "@/lib/matching/matchLog";
import { MAX_NAMES_ON_SCREEN } from "@/lib/matching/SpotterEngine";
import { buildJerseyIndex } from "@/lib/rosters/buildWatchlist";
import type { WatchlistEntry, WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// Booth partners (Nov 15): one screen's cards from two or three mics.
//
// Each laptop runs its own engine on its own mic, exactly as a solo game does;
// lib/matching/ is not touched. This sits between the engine's answer and the
// cards. It takes the engine's on-screen list, and the card events the other
// laptops relay, and says what this screen shows:
//
// - With no partner's card on screen (always, in a solo game) the screen IS
//   the engine's list, the very array, and the views are the scoring cue's own
//   map. That is what keeps a solo game exactly as it was
//   (test/boothScreen.test.ts replays the G5 log through both).
// - With a partner's card up, every card is placed by when it went up, newest
//   first, three at most, one card per player.
// - The same player from two mics within DEDUPE_MS is one card: it went up at
//   the first event, and the second changes nothing.
// - A takedown (X, 1 to 3) of a card that came from a partner's mic is this
//   screen's alone: it never reaches the engine, so it is never logged as this
//   mic's wrong match, and it is never sent to the partner.
//
// HOT PATH: every method is synchronous and allocates little. Nothing here
// reads the network, storage or the clock: the caller passes the time.
// =============================================================================

/** The same player from two mics within this long is one card. */
export const DEDUPE_MS = 3_000;

export type CardSource = "local" | BoothSlot;

interface RemoteCard {
  player: WatchlistPlayer;
  from: BoothSlot;
  /** When it went up on this screen, by this laptop's own clock. */
  at: number;
  view: CardView;
}

/** What happened, for the browser log and the counts after paint. Never a name off this laptop. */
export interface BoothNote {
  what: "remote_up" | "remote_deduped" | "local_deduped" | "remote_down" | "remote_unknown" | "remote_removed" | "remote_view";
  player?: WatchlistPlayer;
  from?: BoothSlot;
}

export interface EngineStep {
  /** The screen changed: show players(). In a solo game, exactly when the engine handed over a list. */
  changed: boolean;
  /** Players this mic put up, to tell the partners. */
  up: WatchlistPlayer[];
  /** Players this mic's final result took back (never a takedown, never a card pushed off), to tell the partners. */
  down: WatchlistPlayer[];
  notes: BoothNote[];
}

export interface PartnerStep {
  changed: boolean;
  /** Cards already up whose view the partner's scoring word turned. */
  turns: Array<{ player: WatchlistPlayer; view: CardView }>;
  notes: BoothNote[];
}

export type TakeDown = { engineSlot: number } | { remote: WatchlistPlayer; from: BoothSlot } | null;

const NOTHING: EngineStep = { changed: false, up: [], down: [], notes: [] };

export class BoothScreen {
  private readonly bySlotKey: Map<string, WatchlistPlayer>;
  private readonly byRosterId = new Map<string, WatchlistPlayer>();
  /** The engine's last list, as it handed it over. */
  private engine: WatchlistPlayer[] = [];
  /** When each of the engine's players went up on this screen. */
  private readonly localAt = new Map<WatchlistPlayer, number>();
  /** Partners' cards, newest first. */
  private remote: RemoteCard[] = [];
  /** Players this screen took down as a partner's card while the engine also holds them, with when. */
  private readonly hidden = new Map<WatchlistPlayer, number>();
  /** When each player last went up, from any mic: the dedupe window. */
  private readonly lastUp = new Map<WatchlistPlayer, number>();
  /** What is on screen now, and where each card came from. */
  private screen: WatchlistPlayer[] = [];
  private sources = new Map<WatchlistPlayer, CardSource>();

  constructor(entries: readonly WatchlistEntry[]) {
    const index = buildJerseyIndex([...entries]);
    this.bySlotKey = new Map([...index.byKey].map(([key, slot]) => [key, slot.player]));
    for (const entry of entries) {
      for (const player of entry.players ?? []) {
        if (player.rosterId && !this.byRosterId.has(player.rosterId)) this.byRosterId.set(player.rosterId, player);
      }
    }
  }

  /** What the screen shows. In a solo game, the engine's own array. */
  players(): WatchlistPlayer[] {
    return this.screen;
  }

  /** Where the card in this slot came from: this mic, or a partner's slot. */
  sourceOf(player: WatchlistPlayer): CardSource {
    return this.sources.get(player) ?? "local";
  }

  /** Any partner's card on screen. */
  hasRemote(): boolean {
    return this.remote.length > 0;
  }

  /**
   * The views to draw with: the scoring cue's own map when no partner's card
   * is up, else a copy where each partner's card leads with the view his mic chose.
   */
  views<T extends ReadonlyMap<WatchlistPlayer, CardView> | undefined>(cue: T): T | Map<WatchlistPlayer, CardView> {
    if (this.remote.length === 0) return cue;
    const views = new Map<WatchlistPlayer, CardView>(cue ?? []);
    for (const card of this.remote) if (this.sources.get(card.player) === card.from) views.set(card.player, card.view);
    return views;
  }

  /** Roster player ids for players, for a card event. A player built before ids is left out. */
  idsOf(players: readonly WatchlistPlayer[]): string[] {
    return players.map((player) => player.rosterId).filter((id): id is string => typeof id === "string");
  }

  /**
   * HOT PATH. The engine's answer for one result: its list when it changed,
   * and its rows. `relay` false for a takedown, whose changes are this
   * screen's alone.
   */
  fromEngine(display: WatchlistPlayer[] | undefined, rows: readonly LogRow[], now: number, relay = true): EngineStep {
    if (!display) return NOTHING;
    const before = this.engine;
    this.engine = display;

    // Who this mic just put up: a match row's players that are new on its list, or moved to the front.
    const fired = new Set<WatchlistPlayer>();
    for (const row of rows) {
      if (row.type !== "match") continue;
      for (const key of row.slots ?? []) {
        const player = this.bySlotKey.get(key);
        if (player && display.includes(player)) fired.add(player);
      }
    }
    const added = display.filter((player) => !before.includes(player));
    const up: WatchlistPlayer[] = [];
    const notes: BoothNote[] = [];
    for (const player of display) {
      const was = before.indexOf(player);
      // Back on the list without being named (the final result took a newer
      // card back, or a takedown): it went up long ago, so it sits last.
      if (was === -1 && !fired.has(player)) {
        this.localAt.set(player, 0);
        continue;
      }
      // Named now: new on the list, or a match row named him again.
      if (was !== -1 && !fired.has(player)) continue;
      const partner = this.remote.find((card) => card.player === player);
      if (partner && now - partner.at < DEDUPE_MS) {
        // A partner put this player up a moment ago: one card, where it already is.
        this.localAt.set(player, partner.at);
        notes.push({ what: "local_deduped", player, from: partner.from });
        continue;
      }
      this.localAt.set(player, now);
      this.lastUp.set(player, now);
      // This mic named him again: his card is this mic's now, at the front.
      if (partner) this.remote = this.remote.filter((card) => card.player !== player);
      const hiddenAt = this.hidden.get(player);
      if (hiddenAt !== undefined && now - hiddenAt >= DEDUPE_MS) this.hidden.delete(player);
      up.push(player);
    }

    // Who left the engine's list: pushed off by newer cards (each screen does
    // that itself), or taken back by the final result (worth telling).
    const removed = before.filter((player) => !display.includes(player));
    const pushedOff = Math.max(0, before.length + added.length - MAX_NAMES_ON_SCREEN);
    const down = removed.slice(0, Math.max(0, removed.length - pushedOff));
    for (const player of removed) {
      this.localAt.delete(player);
      this.hidden.delete(player);
    }

    this.place();
    return { changed: true, up: relay ? up : [], down: relay ? down : [], notes };
  }

  /**
   * HOT PATH. A card event from a partner's laptop. Ids this screen does not
   * know (a roster saved since this laptop last refreshed) are noted and skipped.
   */
  fromPartner(from: BoothSlot, event: CardEvent, now: number): PartnerStep {
    const notes: BoothNote[] = [];
    const players: Array<{ player: WatchlistPlayer; index: number }> = [];
    event.ids.forEach((id, index) => {
      const player = this.byRosterId.get(id);
      if (player) players.push({ player, index });
      else notes.push({ what: "remote_unknown", from });
    });

    if (event.kind === "up") {
      let changed = false;
      // Oldest first, so the first id ends up newest, as it was on the partner's screen.
      for (const { player, index } of [...players].reverse()) {
        const last = this.lastUp.get(player);
        if (last !== undefined && now - last < DEDUPE_MS) {
          notes.push({ what: "remote_deduped", player, from });
          continue;
        }
        this.remote = [{ player, from, at: now, view: event.views[index] ?? "facts" }, ...this.remote.filter((card) => card.player !== player)];
        this.lastUp.set(player, now);
        this.hidden.delete(player);
        notes.push({ what: "remote_up", player, from });
        changed = true;
      }
      if (changed) this.place();
      return { changed, turns: [], notes };
    }

    if (event.kind === "down") {
      const gone = new Set(players.map(({ player }) => player));
      const before = this.remote.length;
      this.remote = this.remote.filter((card) => !(card.from === from && gone.has(card.player)));
      if (this.remote.length === before) return { changed: false, turns: [], notes };
      for (const player of gone) notes.push({ what: "remote_down", player, from });
      this.place();
      return { changed: true, turns: [], notes };
    }

    // A scoring word on the partner's mic turned his card.
    const turns: PartnerStep["turns"] = [];
    for (const { player } of players) {
      const card = this.remote.find((each) => each.player === player && each.from === from);
      if (!card || card.view === event.view) continue;
      card.view = event.view;
      if (this.sources.get(player) === from) {
        turns.push({ player, view: event.view });
        notes.push({ what: "remote_view", player, from });
      }
    }
    return { changed: false, turns, notes };
  }

  /**
   * A key took down the card in this slot. A card from this mic goes to the
   * engine, at the engine's own slot; a partner's card comes down here only.
   */
  takeDown(slot: number, now: number): TakeDown {
    const player = this.screen[slot];
    if (!player) return null;
    const source = this.sourceOf(player);
    if (source === "local") {
      const engineSlot = this.engine.indexOf(player);
      return engineSlot === -1 ? null : { engineSlot };
    }
    this.remote = this.remote.filter((card) => card.player !== player);
    // This mic heard him too: keep him down until the engine lets go, or names him again later.
    if (this.engine.includes(player)) this.hidden.set(player, now);
    this.place();
    return { remote: player, from: source };
  }

  /** Works out the screen from the engine's list and the partners' cards. */
  private place(): void {
    if (this.remote.length === 0 && this.hidden.size === 0) {
      this.screen = this.engine;
      this.sources = new Map();
      return;
    }
    type Card = { player: WatchlistPlayer; at: number; source: CardSource; rank: number };
    const cards: Card[] = [];
    this.engine.forEach((player, index) => {
      if (this.hidden.has(player)) return;
      cards.push({ player, at: this.localAt.get(player) ?? 0, source: "local", rank: index });
    });
    this.remote.forEach((card, index) => cards.push({ player: card.player, at: card.at, source: card.from, rank: 10 + index }));
    // Newest first. On a tie the partner's card wins: it went up first and this mic only joined it.
    cards.sort((a, b) => b.at - a.at || (a.source === "local" ? 1 : 0) - (b.source === "local" ? 1 : 0) || a.rank - b.rank);
    const shown: Card[] = [];
    for (const card of cards) {
      if (shown.length >= MAX_NAMES_ON_SCREEN) break;
      if (shown.some((each) => each.player === card.player)) continue;
      shown.push(card);
    }
    // A partner's card pushed off the screen is gone, as a card pushed off by this mic is.
    this.remote = this.remote.filter((card) => shown.some((each) => each.player === card.player && each.source === card.from));
    this.screen = shown.map((card) => card.player);
    this.sources = new Map(shown.map((card) => [card.player, card.source]));
  }
}
