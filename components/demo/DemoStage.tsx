"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { NameDisplay, type NameDisplayHandle } from "@/components/NameDisplay";
import { asSaid, buildDemoGame, DemoCaller } from "@/lib/demo/demoGame";
import { DEMO_SCRIPT } from "@/lib/demo/footballDemo";
import { sideLooks, splitBackground } from "@/lib/game/colors";
import type { WatchlistPlayer } from "@/lib/watchlist";

// =============================================================================
// The public demo (Nov 19, the UX overhaul's Phase 1). The real card stage
// (NameDisplay) and the real engine (lib/demo/demoGame.ts DemoCaller) on two
// made-up football teams, with no account, no server call, no mic stream to
// StatCast and no spend. A scripted stretch of play-by-play runs line by
// line; the visitor can also type a line, click a name, or say one through
// the browser's own speech recognition where it has one.
//
// `watch` is the landing page's loop: the stage and the lines, no controls.
// Nothing here tracks: a signed-out visitor is never counted.
// =============================================================================

/** How long a script line stays before the next, at 1x. */
const LINE_MS = 2600;
/** The pause at the end of the script before it starts over. */
const END_PAUSE_MS = 3500;
/** Lines kept in the ticker, newest first. */
const TICKER_LINES = 4;

interface TickerLine {
  id: number;
  said: string;
  from: "script" | "you" | "mic";
  up: WatchlistPlayer[];
  quiet?: string;
}

/** The browser's own speech recognition (Chrome, Edge, Safari), typed loosely: the DOM lib does not declare it. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
const noSubscribe = () => () => undefined;

export function DemoStage({ mode = "full" }: { mode?: "full" | "watch" }) {
  const game = useMemo(() => buildDemoGame(), []);
  const displayRef = useRef<NameDisplayHandle>(null);
  const callerRef = useRef<DemoCaller | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);
  const nextId = useRef(1);

  const looks = useMemo(
    () => sideLooks({ color: game.home.color, school: game.home.name }, { color: game.away.color, school: game.away.name }),
    [game],
  );
  const background = useMemo(() => splitBackground(game.away.color, game.home.color), [game]);
  const sideColor = { H: game.home.color, A: game.away.color } as const;

  const [playing, setPlaying] = useState(mode === "watch");
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [at, setAt] = useState(0);
  const [ticker, setTicker] = useState<TickerLine[]>([]);
  const [typed, setTyped] = useState("");
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const canListen = useSyncExternalStore(noSubscribe, () => recognitionConstructor() !== null, () => false);

  // The engine and the measured name fits, once the stage is there.
  useEffect(() => {
    callerRef.current = new DemoCaller(game);
    displayRef.current?.prepare(game.players);
    return () => recognitionRef.current?.abort();
  }, [game]);

  /** One line said: through the engine, onto the stage, into the ticker. */
  const say = (text: string, from: TickerLine["from"], quiet?: string) => {
    const caller = callerRef.current;
    if (!caller) return;
    const heard = caller.say(text);
    displayRef.current?.show(heard.onScreen, looks);
    const line: TickerLine = { id: nextId.current++, said: asSaid(text), from, up: heard.up, quiet: heard.up.length === 0 ? (quiet ?? "Nothing to show") : undefined };
    setTicker((lines) => [line, ...lines].slice(0, TICKER_LINES));
  };

  const restart = () => {
    callerRef.current?.reset();
    displayRef.current?.show([], looks);
    setTicker([]);
    setAt(0);
  };

  // The script, a line at a time while playing; at the end, a pause and round again.
  useEffect(() => {
    if (!playing) return;
    const done = at >= DEMO_SCRIPT.length;
    const timer = setTimeout(
      () => {
        if (done) {
          restart();
          return;
        }
        const line = DEMO_SCRIPT[at];
        say(line.said, "script", line.quiet);
        setAt(at + 1);
      },
      (done ? END_PAUSE_MS : at === 0 ? 700 : LINE_MS) / speed,
    );
    return () => clearTimeout(timer);
    // say and restart read refs and stable values only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, at, speed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (typed.trim().length === 0) return;
    setPlaying(false);
    say(typed, "you");
    setTyped("");
  };

  const listen = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        if (result.isFinal) say(result[0].transcript, "mic");
      }
    };
    recognition.onerror = (event) => {
      setMicNote(event.error === "not-allowed" || event.error === "service-not-allowed" ? "The browser blocked the microphone. Allow it in the address bar, or type a line instead." : null);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setPlaying(false);
    setMicNote(null);
    setListening(true);
    recognition.start();
  };

  const stage = (
    <div className="relative w-full overflow-hidden rounded-[6px] bg-[#6b6b6b] shadow-[0_8px_24px_rgba(0,0,0,0.25)]" style={{ aspectRatio: "33 / 12" }}>
      <NameDisplay
        ref={displayRef}
        dimmed={false}
        placeholder={mode === "watch" ? "" : "Press Play, type a name, or click a player"}
        tonight={false}
        background={background}
      />
    </div>
  );

  const lines = (
    <ol className="flex min-h-[148px] flex-col gap-1" aria-live="polite" aria-label="What the announcer said" data-testid="demo-ticker">
      {ticker.map((line, index) => (
        <li key={line.id} className={`flex flex-wrap items-baseline gap-x-2 text-[16px] ${index === 0 ? "text-ink" : "text-muted"}`}>
          <span className="w-12 shrink-0 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{line.from === "script" ? "Booth" : line.from === "mic" ? "You said" : "You"}</span>
          <span>
            {line.said.split(" ").map((word, place) => {
              const hit = line.up.find((player) => player.last_name.toLowerCase() === word || player.jersey === word);
              return (
                <span key={place}>
                  {place > 0 ? " " : ""}
                  {hit ? (
                    <mark className="rounded-[3px] px-1 font-semibold text-white" style={{ background: sideColor[hit.side] }}>
                      {word}
                    </mark>
                  ) : (
                    word
                  )}
                </span>
              );
            })}
          </span>
          {line.quiet && <span className="rounded-[3px] bg-surface-2 px-1.5 text-[13px] text-muted">{line.quiet}: no card</span>}
        </li>
      ))}
    </ol>
  );

  if (mode === "watch") {
    return (
      <div className="flex flex-col gap-3" data-testid="demo-watch">
        {stage}
        {lines}
      </div>
    );
  }

  const roster = (side: "H" | "A") => {
    const team = side === "H" ? game.home : game.away;
    const players = game.players.filter((player) => player.side === side);
    return (
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold uppercase tracking-[0.04em] text-ink-2">
          <span className="inline-block h-3 w-3 rounded-[2px]" style={{ background: team.color }} aria-hidden />
          {team.name} {team.mascot}
        </h3>
        <ul className="flex flex-wrap gap-1.5">
          {players.map((player) => (
            <li key={`${side}-${player.jersey}-${player.last_name}`}>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  say(player.last_name, "you");
                }}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-[3px] border border-line-strong bg-surface pl-1 pr-2.5 text-[14px] hover:border-ink"
              >
                <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-[2px] px-1 font-semibold text-white" style={{ background: team.color }}>
                  {player.jersey}
                </span>
                {player.last_name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="demo">
      {stage}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((on) => !on)}
          className="inline-flex h-10 min-w-28 cursor-pointer items-center justify-center rounded-[3px] bg-accent px-5 font-semibold text-white hover:bg-accent-hover"
          data-testid="demo-play"
        >
          {playing ? "Pause" : at === 0 ? "Play" : at >= DEMO_SCRIPT.length ? "Play again" : "Resume"}
        </button>
        <button
          type="button"
          onClick={() => setSpeed((value) => (value === 1 ? 2 : 1))}
          className="inline-flex h-10 cursor-pointer items-center rounded-[3px] border border-line-strong bg-surface px-4 hover:border-ink"
          aria-label={`Speed ${speed}x, change`}
        >
          {speed}x
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            restart();
          }}
          className="inline-flex h-10 cursor-pointer items-center rounded-[3px] border border-line-strong bg-surface px-4 hover:border-ink"
        >
          Restart
        </button>
        <span className="text-[14px] text-muted">
          Line {Math.min(at, DEMO_SCRIPT.length)} of {DEMO_SCRIPT.length}
        </span>
      </div>
      {lines}
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={submit} className="flex flex-col gap-2 rounded-[6px] border border-line bg-surface p-4">
          <label htmlFor="demo-say" className="font-semibold">
            Try it: type what an announcer would say
          </label>
          <div className="flex gap-2">
            <input
              id="demo-say"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="langan up the middle, or number 81"
              autoComplete="off"
              maxLength={120}
              className="h-10 min-w-0 flex-1 rounded-[3px] border border-line-strong px-3"
              data-testid="demo-input"
            />
            <button type="submit" className="inline-flex h-10 cursor-pointer items-center rounded-[3px] border border-line-strong bg-surface px-4 font-semibold hover:border-ink">
              Say it
            </button>
          </div>
          {canListen && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={listen}
                className={`inline-flex h-10 cursor-pointer items-center rounded-[3px] px-4 font-semibold ${listening ? "bg-red text-white" : "border border-line-strong bg-surface hover:border-ink"}`}
                data-testid="demo-mic"
              >
                {listening ? "Stop listening" : "Use my microphone"}
              </button>
              <span className="text-[13px] text-muted">
                {listening ? "Listening. Say a name from the lists, or “number 22”." : "Uses your browser's own speech recognition (Chrome sends the audio to Google to write it down). Nothing goes to StatCast."}
              </span>
            </div>
          )}
          {micNote && <p className="text-[14px] text-red">{micNote}</p>}
        </form>
        <div className="flex flex-col gap-4 rounded-[6px] border border-line bg-surface p-4">
          <p className="font-semibold">Or click a player</p>
          {roster("A")}
          {roster("H")}
        </div>
      </div>
    </div>
  );
}
