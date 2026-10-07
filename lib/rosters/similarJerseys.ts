// =============================================================================
// Numbers that sound like each other.
//
// Thirteen and thirty are one consonant apart, and a booth microphone in a loud
// gym loses that consonant. The same goes for 14/40 up to 19/90. Nothing else
// on a jersey collides this reliably, so the rule is exactly these eight pairs
// rather than anything cleverer.
// =============================================================================

/** "15" and "50" are partners. Anything else, including "5" and "50", is not. */
export function teenTyPartner(jersey: string): string | null {
  if (!/^\d{2}$/.test(jersey)) return null;
  const value = Number(jersey);
  if (value >= 13 && value <= 19) return String((value - 10) * 10);
  if (value >= 30 && value <= 90 && value % 10 === 0) return String(value / 10 + 10);
  return null;
}

export interface SimilarJersey {
  jersey: string;
  partner: string;
}

/**
 * Every player on this list whose number has its partner on the list too.
 *
 * Returns one entry per player, in the order given, null where nothing
 * collides. Used by the roster review, so it reads one roster at a time; the
 * game summary runs it across both.
 */
export function flagSimilarJerseys(players: Array<{ jersey: string | null }>): Array<SimilarJersey | null> {
  const worn = new Set<string>();
  for (const player of players) {
    const jersey = (player.jersey ?? "").trim();
    if (jersey.length > 0) worn.add(jersey);
  }

  return players.map((player) => {
    const jersey = (player.jersey ?? "").trim();
    const partner = jersey.length > 0 ? teenTyPartner(jersey) : null;
    return partner !== null && worn.has(partner) ? { jersey, partner } : null;
  });
}

/** One player, as the game summary names them. */
export interface SimilarWearer {
  jersey: string;
  name: string;
  side: "H" | "A";
}

export interface SimilarPair {
  a: SimilarWearer;
  b: SimilarWearer;
}

/**
 * Every pair across tonight's two rosters whose numbers can be heard as each
 * other, listed once each way round.
 *
 * The roster review only sees one team, so this is where a 15 on one side and a
 * 50 on the other finally meet.
 */
export function findSimilarJerseys(
  home: Array<{ jersey: string | null; last_name: string }>,
  away: Array<{ jersey: string | null; last_name: string }>,
): SimilarPair[] {
  const wearers: SimilarWearer[] = [];
  const add = (players: Array<{ jersey: string | null; last_name: string }>, side: "H" | "A") => {
    for (const player of players) {
      const jersey = (player.jersey ?? "").trim();
      if (jersey.length > 0) wearers.push({ jersey, name: player.last_name, side });
    }
  };
  add(home, "H");
  add(away, "A");

  const pairs: SimilarPair[] = [];
  for (const a of wearers) {
    const partner = teenTyPartner(a.jersey);
    if (partner === null) continue;
    for (const b of wearers) {
      if (b.jersey !== partner) continue;
      if (pairs.some((pair) => pair.a === b && pair.b === a)) continue;
      pairs.push({ a, b });
    }
  }
  return pairs;
}
