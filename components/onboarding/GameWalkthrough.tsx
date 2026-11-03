"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RosterEditor } from "@/components/rosters/RosterEditor";
import { Button, ButtonLink, LinkButton } from "@/components/ui/Button";
import { Input, LABEL, Select } from "@/components/ui/Field";
import { Panel } from "@/components/ui/Panel";
import { ErrorRow } from "@/components/ui/Rows";
import { track } from "@/lib/analytics/track";
import { createDraft, saveDraft } from "@/lib/game/draftApi";
import { comingFriday, draftTitle, gameDay, type Draft, type DraftSide } from "@/lib/game/drafts";
import { EMPTY_TEAM } from "@/lib/rosters/editor";
import { MORE_SPORTS, sportOptions, startingSport } from "@/lib/rosters/sportOptions";
import { describeTeam, isSport, type Sport, type TeamSummary } from "@/lib/rosters/types";
import { useToday } from "@/lib/ui/useToday";

/** The walkthrough's steps, in order, as analytics names them. */
type Step = "date" | "away" | "home" | "done";
const STEP_NUMBER: Record<Exclude<Step, "done">, number> = { date: 1, away: 2, home: 3 };

/** Which step a draft is on: no draft is the date, then the away team, then home. */
export function walkthroughStep(draft: Pick<Draft, "awayId" | "homeId"> | null): Step {
  if (!draft) return "date";
  if (!draft.awayId) return "away";
  if (!draft.homeId) return "home";
  return "done";
}

/**
 * "Set up your next game" (Nov 3, Jed): a short wizard for a new announcer.
 * When is it, then the away team's roster, then the home team's, each saved
 * as it goes onto a draft game (lib/game/drafts.ts), so leaving partway still
 * leaves a draft on Home and the Games page. Skip for now on every step.
 *
 * The roster steps are the team page's own editor, embedded: the same import
 * box, review table, warnings and one save path. No season stats here.
 */
export function GameWalkthrough({
  initialDraft,
  teams,
  mySports,
  canImport,
  email,
}: {
  initialDraft: Draft | null;
  teams: TeamSummary[];
  mySports: Sport[];
  /** False for an email account that has not opened its confirmation link: reading a roster costs money. */
  canImport: boolean;
  email: string;
}) {
  const router = useRouter();
  const today = useToday();
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const step = walkthroughStep(draft);

  const skip = () => {
    if (step !== "done") track("onboarding.skipped", { step });
    router.push("/home");
  };

  return (
    <div className="flex flex-col gap-4" data-testid="walkthrough">
      {step !== "done" && (
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-[14px] font-semibold text-ink-2">Step {STEP_NUMBER[step]} of 3</span>
            <div className="h-2 w-full rounded-[3px] bg-surface-2" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={STEP_NUMBER[step]}>
              <div className="h-2 rounded-[3px] bg-accent" style={{ width: `${(STEP_NUMBER[step] / 3) * 100}%` }} />
            </div>
          </div>
          <LinkButton onClick={skip}>Skip for now</LinkButton>
        </div>
      )}

      {step === "date" && today !== null && (
        <DateStep
          today={today}
          mySports={mySports}
          onCreated={(created) => {
            setDraft(created);
            router.replace(`/onboarding/game?draft=${encodeURIComponent(created.id)}`);
          }}
        />
      )}
      {(step === "away" || step === "home") && draft && (
        <TeamStep
          key={`${step}-${draft.id}`}
          side={step}
          draft={draft}
          teams={teams}
          mySports={mySports}
          canImport={canImport}
          email={email}
          onAttached={setDraft}
        />
      )}
      {step === "done" && draft && <Done draft={draft} />}
    </div>
  );
}

function DateStep({ today, mySports, onCreated }: { today: string; mySports: Sport[]; onCreated: (draft: Draft) => void }) {
  const [date, setDate] = useState(comingFriday(today));
  const [sport, setSport] = useState<Sport | "">(startingSport(mySports));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One sport in About you is set without asking.
  const askSport = mySports.length !== 1;

  const create = async () => {
    if (!isSport(sport) || date < today) return;
    setBusy(true);
    setError(null);
    const id = await createDraft({ game_date: date, sport });
    if (!id) {
      setBusy(false);
      setError("Could not save that just now. Check the connection and try again.");
      return;
    }
    track("game.draft_saved", { from: "walkthrough", teams: 0 });
    track("onboarding.step_done", { step: "date" });
    onCreated({ id, gameDate: date, sport, awayId: null, homeId: null, awaySchool: null, homeSchool: null, wearing: { away: null, home: null }, share: true });
  };

  return (
    <Panel heading="When is it?" bodyClassName="flex flex-col gap-4 p-4">
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Date</span>
        <Input type="date" className="w-56" min={today} value={date} onChange={(event) => event.target.value && setDate(event.target.value)} />
        {date < today && <span className="text-[14px] text-red">Pick today or a day after.</span>}
      </label>
      {askSport && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Sport</span>
          <Select
            className="w-56"
            value={sport}
            onChange={(event) => (event.target.value === MORE_SPORTS ? setMore(true) : setSport(isSport(event.target.value) ? event.target.value : ""))}
          >
            <option value="">Pick one</option>
            {sportOptions(mySports, sport, more).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <span className="text-[14px] text-muted">Both teams you add next are this sport.</span>
        </label>
      )}
      <div>
        <Button variant="primary" disabled={busy || !isSport(sport) || date < today} onClick={() => void create()}>
          {busy ? "Saving..." : "Continue"}
        </Button>
      </div>
      {error && <ErrorRow className="px-0" text={error} />}
    </Panel>
  );
}

function TeamStep({
  side,
  draft,
  teams,
  mySports,
  canImport,
  email,
  onAttached,
}: {
  side: DraftSide;
  draft: Draft;
  teams: TeamSummary[];
  mySports: Sport[];
  canImport: boolean;
  email: string;
  onAttached: (next: Draft) => void;
}) {
  const sport: Sport = draft.sport ?? "football";
  const other = side === "away" ? draft.homeId : draft.awayId;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Saved teams to pick from: never the other side's, this sport's first.
  const choices = teams
    .filter((team) => team.id !== other)
    .sort((a, b) => Number(b.sport === sport) - Number(a.sport === sport) || a.school.localeCompare(b.school));

  const attach = async (id: string, school: string) => {
    setBusy(true);
    setError(null);
    const fields = side === "away" ? { away_roster_id: id } : { home_roster_id: id };
    if (!(await saveDraft(draft.id, fields))) {
      setBusy(false);
      setError(id === other ? "That is the other side's team. Pick a different one." : "Could not add the team to the game. Check the connection and try again.");
      return;
    }
    track("onboarding.step_done", { step: side });
    onAttached(side === "away" ? { ...draft, awayId: id, awaySchool: school } : { ...draft, homeId: id, homeSchool: school });
  };

  return (
    <Panel heading={side === "away" ? "Away team" : "Home team"} bodyClassName="flex flex-col gap-4 p-4">
      <p className="text-muted">A MaxPreps PDF, a photo, a spreadsheet, or pasted text all work. Check the names, then Looks right.</p>
      {canImport ? (
        <RosterEditor
          initial={{ id: null, team: { ...EMPTY_TEAM, sport }, players: [] }}
          mySports={mySports}
          embed={{ sport, saveLabel: "Looks right", onSaved: (saved) => void attach(saved.id, saved.school) }}
        />
      ) : (
        <div className="flex flex-col gap-1 rounded-[3px] border border-amber-line bg-amber-fill px-4 py-3 text-amber-text">
          <span className="font-semibold">Confirm your email first.</span>
          <span>
            Reading a roster uses a paid service, so StatCast needs to know {email} is yours. Open the link we sent, or use
            &ldquo;Send it again&rdquo; at the top of the page, then come back here.
          </span>
        </div>
      )}
      {choices.length > 0 &&
        (picking ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="A team you already saved" className="w-96 max-w-full" value={picked} onChange={(event) => setPicked(event.target.value)}>
              <option value="">Pick a saved team</option>
              {choices.map((team) => (
                <option key={team.id} value={team.id}>
                  {describeTeam(team)}
                </option>
              ))}
            </Select>
            <Button
              disabled={!picked || busy}
              onClick={() => {
                const team = choices.find((each) => each.id === picked);
                if (team) void attach(team.id, team.school);
              }}
            >
              {busy ? "Adding..." : "Use this team"}
            </Button>
          </div>
        ) : (
          <p>
            <LinkButton onClick={() => setPicking(true)}>Pick a team I already saved</LinkButton>
          </p>
        ))}
      {error && <ErrorRow className="px-0" text={error} />}
    </Panel>
  );
}

function Done({ draft }: { draft: Draft }) {
  return (
    <Panel heading="Done" bodyClassName="flex flex-col gap-4 p-4">
      <p className="text-[24px] font-semibold" data-testid="walkthrough-done">
        {draftTitle(draft)}, {gameDay(draft.gameDate)}. Saved.
      </p>
      <p className="text-muted">It&apos;s on Home and in Games. Open it any time to check the names before you start.</p>
      <div className="flex flex-wrap items-center gap-3">
        <ButtonLink variant="primary" href="/home" className="h-12 px-6 text-[18px]">
          Go to Home
        </ButtonLink>
        <ButtonLink href={`/games/new?draft=${encodeURIComponent(draft.id)}`}>Start now</ButtonLink>
      </div>
    </Panel>
  );
}
