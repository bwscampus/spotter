"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/Button";
import { INPUT } from "@/components/ui/Field";
import { ErrorRow } from "@/components/ui/Rows";
import { api } from "@/lib/apiClient";
import { track } from "@/lib/analytics/track";
import {
  afterAbout,
  ANNOUNCER_ROLES,
  cleanOtherSport,
  listedSportNamed,
  MAX_OTHER_SPORTS,
  normalizeAbout,
  ROLE_LABELS,
  suggestSports,
  type AnnouncerRole,
  type SportSuggestion,
} from "@/lib/onboarding/about";
import { SPORT_LABELS, SPORTS, type Sport } from "@/lib/rosters/types";

/** The analytics props for a saved "About you": counts and one yes/no per kind of announcing, nothing typed. */
export function aboutSavedProps(sports: readonly Sport[], roles: readonly AnnouncerRole[], otherSports: readonly string[] = []): Record<string, number | boolean> {
  return {
    sports: sports.length,
    other_sports: otherSports.length,
    roles: roles.length,
    ...Object.fromEntries(ANNOUNCER_ROLES.map((role) => [role, roles.includes(role)])),
  };
}

/** The sports with a box of their own: every listed sport but Other, which is the typing box (Nov 4). */
const LISTED = SPORTS.filter((sport) => sport !== "other");

/**
 * "About you" (Nov 3, Jed): two multi-select questions and Continue, asked
 * once right after the first sign-in (`mode="onboarding"`, with a Skip link),
 * and the same two questions in Settings (`mode="settings"`, with Save).
 * Both can be left empty. The sports put the announcer's own first on a new
 * team's Sport list; the kinds of announcing change nothing yet. Since Nov 4
 * "Other" is a box that suggests sports as they type (`OtherSports`).
 */
export function AboutYou({
  initial,
  mode,
  teamCount = 0,
}: {
  initial: { sports: Sport[]; otherSports?: string[]; roles: AnnouncerRole[] };
  mode: "onboarding" | "settings";
  /** Saved teams, which decides where Continue goes (lib/onboarding/about.ts afterAbout). */
  teamCount?: number;
}) {
  const router = useRouter();
  const [sports, setSports] = useState<Sport[]>(initial.sports.filter((sport) => sport !== "other"));
  const [others, setOthers] = useState<string[]>(initial.otherSports ?? []);
  const [roles, setRoles] = useState<AnnouncerRole[]>(initial.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const send = async (body: { sports: Sport[]; other_sports: string[]; roles: AnnouncerRole[] } | { skip: true }) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await api("PATCH", "/api/me", body);
    if (!result.ok) {
      setBusy(false);
      setError("Could not save that just now. Check the connection and try again.");
      return false;
    }
    return true;
  };

  const save = async () => {
    // What the server will keep, worked out the same way, in the lists' own order.
    const about = normalizeAbout(sports, others, roles, SPORT_LABELS);
    if (!(await send({ sports: about.sports, other_sports: about.otherSports, roles: about.roles }))) return;
    if (mode === "settings") {
      setBusy(false);
      setSaved(true);
      router.refresh();
      return;
    }
    track("onboarding.about_saved", aboutSavedProps(about.sports, about.roles, about.otherSports));
    router.push(afterAbout(teamCount));
    router.refresh();
  };

  const skip = async () => {
    if (!(await send({ skip: true }))) return;
    track("onboarding.about_skipped", {});
    router.push(afterAbout(teamCount));
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6" data-testid="about-you">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-[18px] font-semibold text-ink">What sports do you call?</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {LISTED.map((sport) => (
              <Check key={sport} label={SPORT_LABELS[sport]} checked={sports.includes(sport)} onChange={() => setSports(toggle(sports, sport))} />
            ))}
          </div>
          <OtherSports
            sports={sports}
            others={others}
            onPickListed={(sport) => setSports(sports.includes(sport) ? sports : [...sports, sport])}
            onOthers={setOthers}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-[18px] font-semibold text-ink">What kind of announcing do you do?</legend>
          <div className="flex flex-col gap-1">
            {ANNOUNCER_ROLES.map((role) => (
              <Check key={role} label={ROLE_LABELS[role]} checked={roles.includes(role)} onChange={() => setRoles(toggle(roles, role))} />
            ))}
          </div>
        </fieldset>
      </div>
      <p className="text-[14px] text-muted">Pick as many as fit. Your sports come first when you add a team.</p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="primary" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving..." : mode === "settings" ? "Save" : "Continue"}
        </Button>
        {mode === "onboarding" && (
          <LinkButton disabled={busy} onClick={() => void skip()}>
            Skip
          </LinkButton>
        )}
        {saved && (
          <span role="status" className="font-semibold text-green">
            Saved.
          </span>
        )}
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-[3px] px-2 hover:bg-surface-2">
      <input type="checkbox" className="h-5 w-5 cursor-pointer accent-[var(--color-accent)]" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

/** One row of the suggestion list: a sport to pick, or what was typed, added as it is. */
type Option = SportSuggestion | { kind: "typed"; label: string };

/**
 * "Other" sports (Nov 4, Jed: "Make other autofill suggestion based on what
 * they are typing"): a box that suggests sports as the announcer types
 * (lib/onboarding/about.ts suggestSports), a listed one ticking its own box,
 * anything else kept as a chip; what was typed can be added as it is. Arrows
 * move through the suggestions, Enter picks, Escape closes, and a chip's x
 * takes it off.
 */
export function OtherSports({
  sports,
  others,
  onPickListed,
  onOthers,
}: {
  sports: readonly Sport[];
  others: readonly string[];
  onPickListed: (sport: Sport) => void;
  onOthers: (next: string[]) => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const suggestions = suggestSports(text, { sports, others }, SPORT_LABELS);
  const typed = cleanOtherSport(text);
  // What was typed, as its own row, only once nothing on the list matches it
  // (a half-typed word with suggestions showing is not a sport), and never a
  // listed sport or one already picked.
  const addTyped =
    typed !== null &&
    suggestions.length === 0 &&
    listedSportNamed(typed, SPORT_LABELS) === null &&
    !others.some((label) => label.toLowerCase() === typed.toLowerCase());
  const options: Option[] = [...suggestions, ...(addTyped && typed ? [{ kind: "typed" as const, label: typed }] : [])];
  const full = others.length >= MAX_OTHER_SPORTS;
  const showing = open && options.length > 0 && !full;

  const pick = (option: Option) => {
    if (option.kind === "listed") onPickListed(option.sport);
    else {
      const named = listedSportNamed(option.label, SPORT_LABELS);
      if (named) onPickListed(named);
      else if (!others.some((label) => label.toLowerCase() === option.label.toLowerCase())) onOthers([...others, option.label]);
    }
    setText("");
    setActive(0);
    setOpen(false);
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((active + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((active - 1 + options.length) % options.length);
    } else if (event.key === "Enter") {
      // Never submits anything: Enter here picks the highlighted sport.
      event.preventDefault();
      const option = options[Math.min(active, options.length - 1)];
      if (option && !full) pick(option);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  const optionId = (at: number) => `${id}-option-${at}`;

  return (
    <div className="flex flex-col gap-2 pt-2" data-testid="other-sports">
      <label htmlFor={`${id}-input`} className="text-[14px] font-semibold text-ink-2">
        Other sports
      </label>
      {others.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Other sports you call">
          {others.map((label) => (
            <li key={label} className="inline-flex h-9 items-center gap-1 rounded-[3px] border border-line-strong bg-surface-2 pl-3 pr-1">
              <span>{label}</span>
              <button
                type="button"
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[3px] text-muted hover:bg-press hover:text-ink"
                aria-label={`Remove ${label}`}
                onClick={() => onOthers(others.filter((other) => other !== label))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative max-w-[420px]">
        <input
          id={`${id}-input`}
          className={`${INPUT} w-full`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showing}
          aria-controls={listId}
          aria-activedescendant={showing ? optionId(Math.min(active, options.length - 1)) : undefined}
          autoComplete="off"
          maxLength={60}
          disabled={full}
          placeholder={full ? `That's ${MAX_OTHER_SPORTS}, the most it keeps` : "Start typing, like wrestling or tennis"}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {showing && (
          <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[3px] border border-line-strong bg-surface">
            {options.map((option, at) => (
              <li
                key={`${option.kind}-${option.label}`}
                id={optionId(at)}
                role="option"
                aria-selected={at === active}
                className={`flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3 ${at === active ? "bg-surface-2" : ""}`}
                // On mouse down, so the box does not lose the focus (and close) before the pick lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(at)}
              >
                <span>{option.kind === "typed" ? `Add "${option.label}"` : option.label}</span>
                {option.kind === "listed" && <span className="text-[14px] text-muted">ticks its box</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
