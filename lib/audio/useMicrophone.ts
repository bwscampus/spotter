import { useCallback, useEffect, useRef, useState } from "react";

// Browser DSP (echo cancellation, noise suppression, auto gain) smears
// consonants and pumps levels, which hurts name recognition. A broadcast
// headset already delivers a clean, level-controlled signal, so capture raw.
const CAPTURE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 1 },
};

// Stores only the chosen device id. Never audio.
const DEVICE_STORAGE_KEY = "spotter.inputDeviceId";

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
        return "Microphone permission denied. Allow the mic for this site (address bar icon), and on macOS check System Settings → Privacy & Security → Microphone for your browser.";
      case "NotFoundError":
        return "No microphone found. Plug in your headset and turn the mic on again.";
      case "OverconstrainedError":
        return "The selected input device is not available. Plug it in or pick another device.";
      case "NotReadableError":
      case "AbortError":
        return "The input device could not be opened. Another app may be holding it.";
    }
    return `${err.name}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function useMicrophone() {
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [labelsHidden, setLabelsHidden] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState<MicStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [graph, setGraph] = useState<MicGraph | null>(null);

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
      track.stop();
    });
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
    async (id: string) => {
      const generation = ++generationRef.current;
      teardown();
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError(
          "Microphone access is unavailable. Open Spotter at http://localhost:3000 (browsers only allow the mic on localhost or https).",
        );
        return;
      }

      setStatus("starting");
      // Created synchronously inside the click handler so Safari allows it to run.
      // Runs at the device's native rate: forcing a different context rate gave
      // silent input in Chromium testing. The transcription worklet downsamples.
      const context = new AudioContext({ latencyHint: "interactive" });
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { ...CAPTURE_CONSTRAINTS, deviceId: { exact: id } } : CAPTURE_CONSTRAINTS,
        });
      } catch (err) {
        void context.close();
        if (generation !== generationRef.current) return;
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

  const selectDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      saveDeviceId(id);
      if (status === "on" || status === "starting") void start(id);
    },
    [status, start],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshDevices();
      const saved = readSavedDeviceId();
      if (!cancelled && saved) setDeviceId(saved);
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
  };
}
