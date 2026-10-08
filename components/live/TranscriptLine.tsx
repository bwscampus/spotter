"use client";

export interface Transcript {
  final: string;
  interim: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { final: "", interim: "" };

// In memory only, never persisted. Bounded so it cannot grow over a game.
const MAX_FINAL_CHARS = 700;

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

/**
 * The newest words Deepgram heard, for checking what a miss sounded like: two
 * lines on the left of the bottom bar, across all its spare width, the newest
 * at the end of the bottom line and the oldest falling off the top.
 */
export function TranscriptLine({ transcript }: { transcript: Transcript }) {
  return (
    <div
      className="flex h-10 min-w-0 flex-1 flex-col justify-end overflow-hidden text-sm leading-5"
      data-testid="live-transcript"
      title="What speech recognition heard"
    >
      <p className="text-neutral-800">
        {transcript.final}
        {transcript.interim && <span className="text-neutral-600 italic"> {transcript.interim}</span>}
      </p>
    </div>
  );
}
