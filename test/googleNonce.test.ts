import { describe, expect, it } from "vitest";
import { generateNonce, sha256Hex } from "@/lib/auth/googleNonce";

describe("generateNonce", () => {
  it("hands Google the SHA-256 hex of the raw nonce", async () => {
    const { nonce, hashedNonce } = await generateNonce();
    expect(hashedNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(hashedNonce).toBe(await sha256Hex(nonce));
  });

  it("makes a different nonce every time", async () => {
    const first = await generateNonce();
    const second = await generateNonce();
    expect(first.nonce).not.toBe(second.nonce);
  });

  it("hashes like everyone else", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
