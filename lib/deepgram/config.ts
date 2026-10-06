// Deepgram live transcription request. Every option is a query param on the
// websocket URL.
//
// The model and the keyterm encoding are shared with the pre-recorded endpoint
// used by /api/deepgram/check-keyterms, so the check cannot pass against
// settings the live socket does not use.

export const LISTEN_ENDPOINT = "wss://api.deepgram.com/v1/listen";

/** Pre-recorded endpoint. Only used to check keyterms before a game. */
export const PRERECORDED_ENDPOINT = "https://api.deepgram.com/v1/listen";

export const DEEPGRAM_MODEL = "nova-3";

// PRIVACY: opt this request out of Deepgram's Model Improvement Program.
// Deepgram: "Data from opted-out requests is retained only for the duration
// necessary to process the request." Verified 2026-09-14 at
//   https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
//   https://developers.deepgram.com/reference/speech-to-text/listen-streaming
//   (mip_opt_out is a streaming query param, default false).
export const MIP_OPT_OUT = "true";

/**
 * One keyterm param per name, repeated rather than comma-joined, per
 * https://developers.deepgram.com/docs/keyterm
 *
 * Blank terms are skipped: an empty keyterm= param is not the same as sending
 * no keyterms, which is what "start without keyterm boost" means.
 */
export function appendKeyterms(params: URLSearchParams, keyterms: string[]) {
  for (const term of keyterms) {
    const trimmed = term.trim();
    if (trimmed.length > 0) params.append("keyterm", trimmed);
  }
}

export function buildListenUrl(sampleRate: number, keyterms: string[]): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    interim_results: "true",
    smart_format: "false",
    punctuate: "false",
    // Jersey numbers. Without this "twenty three" arrives as two words and a
    // number is guesswork; with it, one token reads "23". Verified against the
    // live socket 2026-09-17. It also renders "half" as "0.5" and "quarter" as
    // "0.25" in the transcript, which is cosmetic: the decimal shape is one of
    // the things that keeps a number off the screen.
    numerals: "true",
    // Raw 16-bit PCM from our AudioWorklet (no container), mono.
    encoding: "linear16",
    sample_rate: String(sampleRate),
    channels: "1",
    mip_opt_out: MIP_OPT_OUT,
  });
  appendKeyterms(params, keyterms);
  return `${LISTEN_ENDPOINT}?${params}`;
}

/**
 * The same request the live socket would make, aimed at the pre-recorded
 * endpoint. Deepgram rejects an over-long keyterm list at connect time, and a
 * rejected websocket gives the browser no usable reason, so the check happens
 * here instead.
 */
export function buildKeytermCheckUrl(keyterms: string[]): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL,
    mip_opt_out: MIP_OPT_OUT,
  });
  appendKeyterms(params, keyterms);
  return `${PRERECORDED_ENDPOINT}?${params}`;
}

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word?: string;
}

export interface DeepgramResults {
  type: "Results";
  is_final: boolean;
  speech_final: boolean;
  start: number;
  duration: number;
  channel: {
    alternatives: Array<{
      transcript: string;
      confidence: number;
      words: DeepgramWord[];
    }>;
  };
}
