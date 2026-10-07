"use client";

import { useEffect, useRef, useState } from "react";

const FLOOR_DB = -60; // bottom of the meter scale
const SILENCE_DB = -55; // quieter than this counts as no signal
const NO_SIGNAL_WARN_MS = 5000; // warn after this long without signal
const PEAK_HOLD_MS = 1500;
const METER_GRADIENT = "linear-gradient(to right, #22c55e 0%, #22c55e 65%, #facc15 80%, #ef4444 95%)";

function dbToFraction(db: number) {
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * Pure browser audio: reads the mic's AnalyserNode every animation frame and
 * writes straight to the DOM (no React re-render per frame). Needs no API key.
 */
export function LevelMeter({ analyser }: { analyser: AnalyserNode | null }) {
  const fillRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [noSignal, setNoSignal] = useState(false);

  useEffect(() => {
    const fill = fillRef.current;
    const peakMarker = peakRef.current;
    const readout = readoutRef.current;
    if (!analyser || !fill || !peakMarker || !readout) return;

    // Scratch buffer overwritten every frame for the level calculation only.
    // It is never copied, stored, or sent anywhere.
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    let peak = 0;
    let peakAt = 0;
    let lastSignalAt = performance.now();
    let warned = false;
    let raf = 0;

    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i++) sumSquares += samples[i] * samples[i];
      const db = 20 * Math.log10(Math.sqrt(sumSquares / samples.length) || 1e-10);

      // Instant attack, eased release, like a hardware meter.
      const target = dbToFraction(db);
      level = target > level ? target : level + (target - level) * 0.12;
      if (level >= peak || now - peakAt > PEAK_HOLD_MS) {
        peak = level;
        peakAt = now;
      }

      fill.style.clipPath = `inset(0 ${(1 - level) * 100}% 0 0)`;
      peakMarker.style.left = `calc(${peak * 100}% - 2px)`;
      peakMarker.style.opacity = peak > 0.02 ? "1" : "0";
      readout.textContent = db <= FLOOR_DB ? `< ${FLOOR_DB} dB` : `${Math.round(db)} dB`;

      if (db > SILENCE_DB) lastSignalAt = now;
      const silent = now - lastSignalAt > NO_SIGNAL_WARN_MS;
      if (silent !== warned) {
        warned = silent;
        setNoSignal(silent);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      fill.style.clipPath = "inset(0 100% 0 0)";
      peakMarker.style.opacity = "0";
      readout.textContent = "off";
      setNoSignal(false);
    };
  }, [analyser]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4 text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
        <span>Input level</span>
        <span ref={readoutRef} className="font-mono normal-case tracking-normal text-neutral-700 tabular-nums">
          off
        </span>
      </div>
      <div className="relative h-4 w-56 overflow-hidden rounded bg-neutral-200" data-testid="level-meter">
        <div
          ref={fillRef}
          className="absolute inset-0"
          style={{ background: METER_GRADIENT, clipPath: "inset(0 100% 0 0)" }}
        />
        {/* -18 dB and -6 dB reference ticks */}
        <div className="absolute inset-y-0 left-[70%] w-px bg-neutral-400" />
        <div className="absolute inset-y-0 left-[90%] w-px bg-neutral-400" />
        <div ref={peakRef} className="absolute inset-y-0 w-1 bg-black opacity-0" />
      </div>
      <p className="h-4 text-xs">
        {analyser && noSignal ? (
          <span className="font-semibold text-amber-600">No signal. Check device and gain.</span>
        ) : (
          " "
        )}
      </p>
    </div>
  );
}
