"use client";

import type { MicSource as Source } from "@/lib/audio/useMicrophone";
import type { AudioLevel } from "@/lib/deepgram/useDeepgramStream";

/**
 * Where the sound comes from (testrun, Oct 3): a TV or speaker across the
 * room, which gets the browser's automatic gain and Spotter's boost, or a
 * headset at the announcer's mouth, which is captured raw as V2 did. Under it,
 * the boost being added right now.
 */
export function MicSource({
  source,
  onChange,
  level,
}: {
  source: Source;
  onChange: (source: Source) => void;
  level: AudioLevel | null;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor="mic-source" className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        Sound from
      </label>
      <select
        id="mic-source"
        value={source}
        // Hands the keyboard back at once, like the device picker, so X still works.
        onChange={(e) => {
          e.target.blur();
          onChange(e.target.value === "headset" ? "headset" : "room");
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="h-10 w-56 max-w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 text-sm text-neutral-900 focus:border-neutral-600 focus:outline-none"
      >
        <option value="room">A TV or speaker in the room</option>
        <option value="headset">A headset mic</option>
      </select>
      <p className="h-4 text-xs tabular-nums text-neutral-500">
        {source === "headset"
          ? "Raw, no boost"
          : level
            ? `Speech ${Math.round(level.speechDb)} dB · boost +${Math.max(0, Math.round(level.gainDb))} dB`
            : "Boosts quiet sound"}
      </p>
    </div>
  );
}
