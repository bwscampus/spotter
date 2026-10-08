import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Where the sound comes from. A headset at the announcer's mouth, which is
 * what V2 was built for, or a TV or speaker across the room (testrun, Oct 3:
 * a TV heard through the laptop's own mic arrived too quiet for Deepgram).
 */
export type MicSource = "room" | "headset";

/**
 * A high school announcer calls into a headset, so that is where a new
 * browser starts (pre-launch audit H10): raw capture, as V2 did. The room
 * setting, with the browser's automatic gain and the worklet's boost, is for
 * hearing a TV across the room, and is one click away in the Audio menu. A
 * choice made there is saved and wins over this.
 */
export const DEFAULT_MIC_SOURCE: MicSource = "headset";

/** The saved choice, or the default when there is none or it is not one of the two. */
export function sourceFrom(saved: string | null): MicSource {
  return saved === "room" || saved === "headset" ? saved : DEFAULT_MIC_SOURCE;
}

/**
 * When a reopen of the chosen device fails because the device is gone (a
 * headset unplugged), the mic is opened on the browser's default instead
 * (pre-launch audit L11). Any other failure, such as a refused permission, is
 * not a missing device and is reported as it is.
 */
export function shouldFallBackToDefault(deviceId: string, err: unknown): boolean {
  if (!deviceId) return false;
  const name = err instanceof Error || err instanceof DOMException ? err.name : "";
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/**
 * Browser DSP (echo cancellation, noise suppression, auto gain) smears
 * consonants and pumps levels, which hurts name recognition. A broadcast
 * headset already delivers a clean, level-controlled signal, so capture raw.
 * A room is the opposite case: the voice arrives far below a headset's, so the
 * browser's automatic gain is turned on (the worklet's boost then makes up
 * whatever it leaves). Echo cancellation and noise suppression stay off for
 * both, because the TV's voice is the thing being listened to.
 */
export function captureConstraints(source: MicSource): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: source === "room",
    channelCount: { ideal: 1 },
  };
}

// Stores only the chosen device id. Never audio.
const DEVICE_STORAGE_KEY = "spotter.inputDeviceId";
// Stores only "room" or "headset".
const SOURCE_STORAGE_KEY = "spotter.micSource";

function readSavedSource(): MicSource {
  try {
    return sourceFrom(localStorage.getItem(SOURCE_STORAGE_KEY));
  } catch {
    return DEFAULT_MIC_SOURCE;
  }
}

function saveSource(source: MicSource) {
  try {
    localStorage.setItem(SOURCE_STORAGE_KEY, source);
  } catch {
    // Storage blocked: the setting still works for this session.
  }
}

export type MicStatus = "off" | "starting" | "on" | "error";

export interface InputDevice {
  deviceId: string;
  label: string;
}

/** Live Web Audio graph for the open mic. Exists only while the mic is on. */
export interface MicGraph {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
}

function readSavedDeviceId(): string {
  try {
    return localStorage.getItem(DEVICE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveDeviceId(id: string) {
  try {
    if (id) localStorage.setItem(DEVICE_STORAGE_KEY, id);
    else localStorage.removeItem(DEVICE_STORAGE_KEY);
  } catch {
    // Storage blocked: the picker still works for this session.
  }
}

function describeGetUserMediaError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone permission denied. Allow the mic for this site (the icon in the address bar), and check that your computer's privacy settings let this browser use the microphone.";
      case "NotFoundError":
        return "No microphone found. Plug in your headset and turn the mic on again.";
      case "OverconstrainedError":
        return "The selected input device is not available. Plug it in or pick another device.";
      case "NotReadableError":
      case "AbortError":
        return "The input device could not be opened. Another app may be holding it.";
    }
  }
  return "The microphone could not be opened. Turn it on again, or pick another device under Audio.";
}

export function useMicrophone() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState<MicStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [graph, setGraph] = useState<MicGraph | null>(null);
  const [source, setSource] = useState<MicSource>(DEFAULT_MIC_SOURCE);
  // The track reports mute and unmute (the OS or another app took the input);
  // the silence alarm watches it (Oct 4).
  const [muted, setMuted] = useState(false);
  // Read by start(), which must not change identity when the setting does.
  const sourceRef = useRef<MicSource>(DEFAULT_MIC_SOURCE);

  const streamRef = useRef<MediaStream | null>(null);
  const graphRef = useRef<MicGraph | null>(null);
  // Bumped on every start/stop, so a slow getUserMedia that resolves after the
  // user already turned the mic off (or switched device) is discarded.
  const generationRef = useRef(0);

  const refreshDevices = useCallback(async (): Promise<InputDevice[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
    // Until mic permission is granted, browsers hide labels and often ids.
    const listed = inputs
      .filter((d) => d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    setLabelsHidden(inputs.some((d) => !d.label));
    setDevices(listed);
    return listed;
  }, []);

  /** Fully releases the device: tracks stopped, not muted. */
  const teardown = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    setMuted(false);
    const g = graphRef.current;
    graphRef.current = null;
    if (g) {
      g.source.disconnect();
      void g.context.close();
    }
    setGraph(null);
    setActiveLabel(null);
  }, []);

  /** Cancels any in-flight start, then releases the device. */
  const release = useCallback(() => {
    generationRef.current++;
    teardown();
  }, [teardown]);

  const start = useCallback(
    // `fallBack`: when the device is gone, open the default one instead (the silence alarm's restart).
    async function open(id: string, fallBack = false): Promise<void> {
      const generation = ++generationRef.current;
      teardown();
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("Spotter can't reach a microphone here. Open it in Chrome on a laptop, over https.");
        return;
      }

      setStatus("starting");
      // Created synchronously inside the click handler so Safari allows it to run.
      // Runs at the device's native rate: forcing a different context rate gave
      // silent input in Chromium testing. The transcription worklet downsamples.
      const context = new AudioContext({ latencyHint: "interactive" });
      let stream: MediaStream;
      try {
        const constraints = captureConstraints(sourceRef.current);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { ...constraints, deviceId: { exact: id } } : constraints,
        });
      } catch (err) {
        void context.close();
        if (generation !== generationRef.current) return;
        if (fallBack && shouldFallBackToDefault(id, err)) {
          // The chosen device is gone. The default keeps the game hearing;
          // the saved choice is left alone for when it comes back.
          await open("", false);
          return;
        }
        setStatus("error");
        setError(describeGetUserMediaError(err));
        return;
      }
      if (generation !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        void context.close();
        return;
      }

      const track = stream.getAudioTracks()[0];
      setMuted(track.muted);
      track.onmute = () => {
        if (generation === generationRef.current) setMuted(true);
      };
      track.onunmute = () => {
        if (generation === generationRef.current) setMuted(false);
      };
      track.onended = () => {
        if (generation !== generationRef.current) return;
        release();
        setStatus("error");
        setError(
          "Microphone input stopped. The device was unplugged or taken by another app. Check the headset, then turn the mic on again.",
        );
      };
      streamRef.current = stream;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      // Deliberately not connected to context.destination: no monitor playback.
      source.connect(analyser);
      const g: MicGraph = { context, source, analyser };
      graphRef.current = g;

      await context.resume().catch(() => undefined);
      if (generation !== generationRef.current) return;

      setGraph(g);
      setActiveLabel(track.label || "Unnamed input");
      setStatus("on");

      // Device labels become visible once permission has been granted. When the
      // browser picked the device, show that device in the picker.
      const listed = await refreshDevices();
      const actualId = track.getSettings().deviceId;
      if (
        generation === generationRef.current &&
        !id &&
        actualId &&
        listed.some((d) => d.deviceId === actualId)
      ) {
        setDeviceId(actualId);
      }
    },
    [teardown, release, refreshDevices],
  );

  const stop = useCallback(() => {
    release();
    setStatus("off");
    setError(null);
  }, [release]);

  const toggle = useCallback(() => {
    if (status === "on" || status === "starting") stop();
    else void start(deviceId);
  }, [status, deviceId, start, stop]);

  /**
   * Opens the mic again on the same device: the silence alarm's first move
   * when the mic is the problem (Oct 4). If that device is gone, the browser's
   * default instead (pre-launch audit L11).
   */
  const restart = useCallback(() => {
    void start(deviceId, true);
  }, [start, deviceId]);

  const selectDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      saveDeviceId(id);
      if (status === "on" || status === "starting") void start(id);
    },
    [status, start],
  );

  /** TV or room, or headset. Reopens the mic if it is on, since the browser's gain is set when it opens. */
  const selectSource = useCallback(
    (next: MicSource) => {
      sourceRef.current = next;
      setSource(next);
      saveSource(next);
      if (status === "on" || status === "starting") void start(deviceId);
    },
    [status, start, deviceId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshDevices();
      const saved = readSavedDeviceId();
      if (!cancelled && saved) setDeviceId(saved);
      const savedSource = readSavedSource();
      if (!cancelled) {
        sourceRef.current = savedSource;
        setSource(savedSource);
      }
    })();

    const mediaDevices = navigator.mediaDevices;
    const onDeviceChange = () => void refreshDevices();
    mediaDevices?.addEventListener("devicechange", onDeviceChange);
    return () => {
      cancelled = true;
      mediaDevices?.removeEventListener("devicechange", onDeviceChange);
      release();
    };
  }, [refreshDevices, release]);

  return {
    devices,
    labelsHidden,
    deviceId,
    selectDevice,
    status,
    error,
    activeLabel,
    graph,
    toggle,
    muted,
    restart,
    source,
    selectSource,
  };
}
