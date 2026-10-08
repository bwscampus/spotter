import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { MicGraph } from "@/lib/audio/useMicrophone";
import { AUDIO_CAPTURE_FAILED_MESSAGE } from "@/lib/messages";
import type { DeepgramResults } from "./config";
import { DeepgramStream, type ConnectionState } from "./DeepgramStream";

const AUDIO_CHUNK_MS = 50;
// 16 kHz is plenty for speech and a third of the upload bandwidth of 48 kHz.
// The worklet low-passes and downsamples from the mic's native rate.
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const WORKLET_URL = "/pcm-capture-worklet.js";

/** The worklet's once-a-second report: the loudest recent speech before any boost, and the boost. */
export interface AudioLevel {
  speechDb: number;
  gainDb: number;
}

interface UseDeepgramStreamOptions {
  graph: MicGraph | null;
  enabled: boolean;
  keyterms: string[];
  /** Raise a quiet room towards a usable level (the worklet's boost). Off is V2's raw audio. */
  boost?: boolean;
  /** Called about once a second, off the hot path. */
  onLevel?: (level: AudioLevel) => void;
  /** Called synchronously from the socket's message handler. */
  onResults: (results: DeepgramResults, receivedAt: number, connectionId: number) => void;
}

/** The connection, plus a way to drop the socket and open a new one with a fresh token (Oct 4, the silence alarm). */
export type DeepgramConnection = ConnectionState & { reconnect: (reason: string) => void };

/** Streams the open mic to Deepgram while `graph` exists and `enabled` is true. */
export function useDeepgramStream({
  graph,
  enabled,
  keyterms,
  boost = false,
  onLevel,
  onResults,
}: UseDeepgramStreamOptions): DeepgramConnection {
  const [state, setState] = useState<ConnectionState>({ status: "idle" });
  const handleResults = useEffectEvent(onResults);
  const handleLevel = useEffectEvent((level: AudioLevel) => onLevel?.(level));
  const keytermsKey = keyterms.join("\n");
  // The stream of the current effect, so reconnect() reaches the live socket.
  const streamRef = useRef<DeepgramStream | null>(null);
  const reconnect = useCallback((reason: string) => streamRef.current?.reconnect(reason), []);

  useEffect(() => {
    if (!graph || !enabled) return;
    const { context, source } = graph;
    const sampleRate = Math.min(TRANSCRIPTION_SAMPLE_RATE, context.sampleRate);
    let cancelled = false;
    let node: AudioWorkletNode | null = null;

    const stream = new DeepgramStream({
      sampleRate,
      // Empty string means no keyterms at all, not one blank keyterm.
      keyterms: keytermsKey ? keytermsKey.split("\n") : [],
      onResults: (results, receivedAt, connectionId) => handleResults(results, receivedAt, connectionId),
      onState: (next) => {
        if (!cancelled) setState(next);
      },
    });

    void (async () => {
      try {
        await context.audioWorklet.addModule(WORKLET_URL);
      } catch {
        if (!cancelled) setState({ status: "failed", reason: AUDIO_CAPTURE_FAILED_MESSAGE });
        return;
      }
      if (cancelled) return;
      node = new AudioWorkletNode(context, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { chunkMs: AUDIO_CHUNK_MS, targetSampleRate: sampleRate, boost },
      });
      // Each chunk goes straight onto the socket and is not referenced again.
      // Anything else from the worklet is its level report.
      node.port.onmessage = (event: MessageEvent<ArrayBuffer | AudioLevel>) => {
        if (event.data instanceof ArrayBuffer) stream.sendAudio(event.data);
        else handleLevel(event.data);
      };
      source.connect(node);
      streamRef.current = stream;
      stream.start();
    })();

    return () => {
      cancelled = true;
      if (streamRef.current === stream) streamRef.current = null;
      stream.stop();
      if (node) {
        node.port.onmessage = null;
        node.port.postMessage("stop");
        try {
          source.disconnect(node);
        } catch {
          // Already disconnected when the mic graph was torn down.
        }
      }
      setState({ status: "idle" });
    };
  }, [graph, enabled, keytermsKey, boost]);

  return useMemo(() => ({ ...state, reconnect }), [state, reconnect]);
}
