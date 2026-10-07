import { useEffect, useEffectEvent, useState } from "react";
import type { MicGraph } from "@/lib/audio/useMicrophone";
import type { DeepgramResults } from "./config";
import { DeepgramStream, type ConnectionState } from "./DeepgramStream";

const AUDIO_CHUNK_MS = 50;
// 16 kHz is plenty for speech and a third of the upload bandwidth of 48 kHz.
// The worklet low-passes and downsamples from the mic's native rate.
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const WORKLET_URL = "/pcm-capture-worklet.js";

interface UseDeepgramStreamOptions {
  graph: MicGraph | null;
  enabled: boolean;
  keyterms: string[];
  /** Called synchronously from the socket's message handler. */
  onResults: (results: DeepgramResults, receivedAt: number, connectionId: number) => void;
}

/** Streams the open mic to Deepgram while `graph` exists and `enabled` is true. */
export function useDeepgramStream({
  graph,
  enabled,
  keyterms,
  onResults,
}: UseDeepgramStreamOptions): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ status: "idle" });
  const handleResults = useEffectEvent(onResults);
  const keytermsKey = keyterms.join("\n");

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
      } catch (err) {
        if (!cancelled) {
          const reason = err instanceof Error ? err.message : String(err);
          setState({ status: "failed", reason: `Audio capture module failed to load: ${reason}` });
        }
        return;
      }
      if (cancelled) return;
      node = new AudioWorkletNode(context, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { chunkMs: AUDIO_CHUNK_MS, targetSampleRate: sampleRate },
      });
      // Each chunk goes straight onto the socket and is not referenced again.
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => stream.sendAudio(event.data);
      source.connect(node);
      stream.start();
    })();

    return () => {
      cancelled = true;
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
  }, [graph, enabled, keytermsKey]);

  return state;
}
