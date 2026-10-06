// Deepgram's pre-recorded endpoint validates the query params before it does
// anything with the audio, so the cheapest way to ask "are these keyterms
// acceptable?" is to send the smallest real WAV we can build.

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

/** One second of silent 16 kHz mono PCM, wrapped in a RIFF/WAVE header. */
export function silentWav(seconds = 1, sampleRate = 16000): Uint8Array {
  const frames = Math.max(1, Math.round(seconds * sampleRate));
  const dataBytes = frames * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true); // file size after this field
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format 1 = PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8), true); // byte rate
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true); // block align
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  // The samples themselves stay zero: silence.

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}
