"use client";

export interface Transcript {
  final: string;
  interim: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { final: "", interim: "" };

// In memory only, never persisted. Bounded so it cannot grow over a game.
const MAX_FINAL_CHARS = 300;

function keepTail(text: string): string {
  if (text.length <= MAX_FINAL_CHARS) return text;
  const tail = text.slice(-MAX_FINAL_CHARS);
  const space = tail.indexOf(" ");
  return space === -1 ? tail : tail.slice(space + 1);
}

/** Deepgram sends interim guesses for the current segment, then one final for it. */
export function applyResult(prev: Transcript, text: string, isFinal: boolean): Transcript {
  if (!isFinal) return { final: prev.final, interim: text };
  if (!text) return { final: prev.final, interim: "" };
  return { final: keepTail(prev.final ? `${prev.final} ${text}` : text), interim: "" };
}

/** One dim line with the newest words Deepgram heard, for checking what a miss sounded like. */
export function TranscriptLine({ transcript }: { transcript: Transcript }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        Raw transcript
      </span>
      <div className="flex h-5 justify-end overflow-hidden whitespace-nowrap text-sm" data-testid="live-transcript">
        <span className="text-neutral-600">
          {transcript.final}
          {transcript.interim && <span className="text-neutral-400"> {transcript.interim}</span>}
        </span>
      </div>
    </div>
  );
}
