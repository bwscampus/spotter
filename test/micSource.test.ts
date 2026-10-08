import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MicSource } from "@/components/live/MicSource";
import { QuietWatch, TOO_QUIET_DB } from "@/lib/audio/quietWatch";
import { captureConstraints, DEFAULT_MIC_SOURCE, shouldFallBackToDefault, sourceFrom } from "@/lib/audio/useMicrophone";

// Hearing a TV across the room (testrun, Oct 3): the Ohio State at Iowa log
// showed Deepgram getting every second of audio and finding speech in under a
// fifth of it, because a raw built-in mic heard the TV far too quietly.

describe("where the sound comes from", () => {
  it("captures a headset raw, exactly as V2 did", () => {
    expect(captureConstraints("headset")).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    });
  });

  it("turns the browser's automatic gain on for a room, and nothing else", () => {
    expect(captureConstraints("room")).toEqual({ ...captureConstraints("headset"), autoGainControl: true });
  });

  it("starts a new browser on the headset, raw, which is how a high school announcer calls (audit H10)", () => {
    expect(DEFAULT_MIC_SOURCE).toBe("headset");
    expect(sourceFrom(null)).toBe("headset");
    expect(sourceFrom("")).toBe("headset");
    expect(sourceFrom("tv")).toBe("headset");
  });

  it("keeps a choice saved in the Audio menu over the default", () => {
    expect(sourceFrom("room")).toBe("room");
    expect(sourceFrom("headset")).toBe("headset");
  });

  it("reopens on the default device only when the chosen one is gone (audit L11)", () => {
    const failure = (name: string) => new DOMException("gone", name);
    expect(shouldFallBackToDefault("usb-headset", failure("OverconstrainedError"))).toBe(true);
    expect(shouldFallBackToDefault("usb-headset", failure("NotFoundError"))).toBe(true);
    // A refused permission is not a missing device, and the default has nothing to fall back from.
    expect(shouldFallBackToDefault("usb-headset", failure("NotAllowedError"))).toBe(false);
    expect(shouldFallBackToDefault("", failure("NotFoundError"))).toBe(false);
  });

  it("shows the speech level and the boost under the setting", () => {
    const html = (source: "room" | "headset", level: { speechDb: number; gainDb: number } | null) =>
      renderToStaticMarkup(createElement(MicSource, { source, onChange: () => undefined, level }));
    expect(html("room", { speechDb: -41, gainDb: 18 })).toContain("Speech -41 dB · boost +18 dB");
    expect(html("room", null)).toContain("Boosts quiet sound");
    expect(html("headset", { speechDb: -20, gainDb: 0 })).toContain("Raw, no boost");
  });
});

describe("too quiet for Deepgram", () => {
  const report = (speechDb: number, gainDb = 0) => ({ speechDb, gainDb });

  it("warns after ten seconds of speech that stays too quiet even with the boost", () => {
    const watch = new QuietWatch();
    // -56 dB is playing (above silence), and +20 dB only brings it to -36.
    expect(-56 + 20).toBeLessThan(TOO_QUIET_DB);
    expect(watch.update(report(-56, 20), 0)).toBe(false);
    expect(watch.update(report(-56, 20), 9_000)).toBe(false);
    expect(watch.update(report(-56, 20), 10_000)).toBe(true);
  });

  it("does not warn when the boost brings speech up to level", () => {
    const watch = new QuietWatch();
    for (let t = 0; t <= 20_000; t += 1_000) expect(watch.update(report(-40, 18), t)).toBe(false);
  });

  it("does not call silence too quiet", () => {
    const watch = new QuietWatch();
    for (let t = 0; t <= 20_000; t += 1_000) expect(watch.update(report(-60, 20), t)).toBe(false);
  });

  it("clears after three seconds loud enough", () => {
    const watch = new QuietWatch();
    for (let t = 0; t <= 10_000; t += 1_000) watch.update(report(-50, 10), t);
    expect(watch.update(report(-30, 5), 11_000)).toBe(true);
    expect(watch.update(report(-30, 5), 14_000)).toBe(false);
  });
});
