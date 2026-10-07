/**
 * True when a printed name could be split into first and last in more than one
 * way, for example "Marli Richardson Barnes", where the surname is either
 * "Barnes" or "Richardson Barnes".
 *
 * A hyphen settles it, so a hyphenated name is never ambiguous.
 */
export function isAmbiguousLastName(firstName: string | null, lastName: string): boolean {
  const printed = `${firstName ?? ""} ${lastName}`.trim();
  if (/[-‐-―]/.test(printed)) return false;
  return printed.split(/\s+/).filter(Boolean).length >= 3;
}

/**
 * The ways a printed name can be split, longest surname first. Used by the
 * review screen's surname picker.
 *
 * "Marli Richardson Barnes" gives "Richardson Barnes" then "Barnes".
 */
export function surnameSplits(firstName: string | null, lastName: string): Array<{ first: string; last: string }> {
  const words = `${firstName ?? ""} ${lastName}`.trim().split(/\s+/).filter(Boolean);
  const splits: Array<{ first: string; last: string }> = [];
  // At least one word stays with the first name.
  for (let take = words.length - 1; take >= 1; take--) {
    splits.push({ first: words.slice(0, words.length - take).join(" "), last: words.slice(-take).join(" ") });
  }
  return splits;
}
