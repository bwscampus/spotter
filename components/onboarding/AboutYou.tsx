"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { ErrorRow } from "@/components/ui/Rows";
import { api } from "@/lib/apiClient";
import { track } from "@/lib/analytics/track";
import { afterAbout, ANNOUNCER_ROLES, ROLE_LABELS, type AnnouncerRole } from "@/lib/onboarding/about";
import { SPORT_LABELS, SPORTS, type Sport } from "@/lib/rosters/types";

/** The analytics props for a saved "About you": counts and one yes/no per kind of announcing, nothing typed. */
export function aboutSavedProps(sports: readonly Sport[], roles: readonly AnnouncerRole[]): Record<string, number | boolean> {
  return { sports: sports.length, roles: roles.length, ...Object.fromEntries(ANNOUNCER_ROLES.map((role) => [role, roles.includes(role)])) };
}

/**
 * "About you" (Nov 3, Jed): two multi-select questions and Continue, asked
 * once right after the first sign-in (`mode="onboarding"`, with a Skip link),
 * and the same two questions in Settings (`mode="settings"`, with Save).
 * Both can be left empty. The sports put the announcer's own first on a new
 * team's Sport list; the kinds of announcing change nothing yet.
 */
export function AboutYou({
  initial,
  mode,
  teamCount = 0,
}: {
  initial: { sports: Sport[]; roles: AnnouncerRole[] };
  mode: "onboarding" | "settings";
  /** Saved teams, which decides where Continue goes (lib/onboarding/about.ts afterAbout). */
  teamCount?: number;
}) {
  const router = useRouter();
  const [sports, setSports] = useState<Sport[]>(initial.sports);
  const [roles, setRoles] = useState<AnnouncerRole[]>(initial.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const send = async (body: { sports: Sport[]; roles: AnnouncerRole[] } | { skip: true }) => {
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
    // In the lists' own order, so the saved answer never depends on the click order.
    const pickedSports = SPORTS.filter((sport) => sports.includes(sport));
    const pickedRoles = ANNOUNCER_ROLES.filter((role) => roles.includes(role));
    if (!(await send({ sports: pickedSports, roles: pickedRoles }))) return;
    if (mode === "settings") {
      setBusy(false);
      setSaved(true);
      router.refresh();
      return;
    }
    track("onboarding.about_saved", aboutSavedProps(pickedSports, pickedRoles));
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
            {SPORTS.map((sport) => (
              <Check key={sport} label={SPORT_LABELS[sport]} checked={sports.includes(sport)} onChange={() => setSports(toggle(sports, sport))} />
            ))}
          </div>
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
