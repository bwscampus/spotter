import { describe, expect, it } from "vitest";
import { silentWav } from "@/lib/deepgram/silentWav";

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const uint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

const uint16 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);

describe("silentWav", () => {
  const wav = silentWav();

  it("is one second of 16 kHz mono 16-bit PCM", () => {
    expect(wav.byteLength).toBe(44 + 16000 * 2);
    expect(uint16(wav, 22)).toBe(1); // channels
    expect(uint32(wav, 24)).toBe(16000); // sample rate
    expect(uint16(wav, 34)).toBe(16); // bits per sample
  });

  it("carries a RIFF/WAVE header Deepgram can read", () => {
    expect(ascii(wav, 0, 4)).toBe("RIFF");
    expect(ascii(wav, 8, 4)).toBe("WAVE");
    expect(ascii(wav, 12, 4)).toBe("fmt ");
    expect(ascii(wav, 36, 4)).toBe("data");
    expect(uint32(wav, 4)).toBe(wav.byteLength - 8);
    expect(uint32(wav, 40)).toBe(wav.byteLength - 44);
  });

  it("declares a byte rate that matches the format", () => {
    expect(uint32(wav, 28)).toBe(16000 * 2);
    expect(uint16(wav, 32)).toBe(2);
  });

  it("is silent", () => {
    expect(wav.subarray(44).every((byte) => byte === 0)).toBe(true);
  });

  it("can be made shorter", () => {
    expect(silentWav(0.5).byteLength).toBe(44 + 8000 * 2);
  });
});
