import { describe, expect, it } from "vitest";
import { COMMON_PASSWORDS } from "@/lib/server/commonPasswords";
import {
  dummyPasswordHash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordProblem,
  verifyPassword,
} from "@/lib/server/password";

describe("hashPassword (AUTH-1)", () => {
  it("is scrypt with its cost and a random salt written into the hash, never the password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(hash).not.toContain("correct horse battery");
    // A fresh salt every time, so two accounts with one password do not share a hash.
    expect(await hashPassword("correct horse battery")).not.toBe(hash);
  });

  it("verifies the right password and refuses a wrong one", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("treats the same password typed in another Unicode form as the same", async () => {
    const hash = await hashPassword("café au lait");
    expect(await verifyPassword("café au lait", hash)).toBe(true);
  });

  it("is false, never an error, for a missing or broken hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
    expect(await verifyPassword("anything", "bcrypt$1$2$3$aa$bb")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$32768$8$1$aa$")).toBe(false);
    // A cost that would ask for gigabytes is refused before scrypt runs.
    expect(await verifyPassword("anything", `scrypt$${2 ** 24}$8$1$aa$bb`)).toBe(false);
    expect(await verifyPassword("anything", "scrypt$1000$8$1$aa$bb")).toBe(false);
  });

  it("has a dummy hash that nothing matches, made once", async () => {
    const dummy = await dummyPasswordHash();
    expect(dummy).toMatch(/^scrypt\$/);
    expect(await dummyPasswordHash()).toBe(dummy);
    expect(await verifyPassword("", dummy)).toBe(false);
    expect(await verifyPassword("password", dummy)).toBe(false);
  });
});

describe("passwordProblem (AUTH-1)", () => {
  it("asks for at least 8 characters", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(passwordProblem("x7#kQ2m")?.code).toBe("weak_password");
    expect(passwordProblem("x7#kQ2mz")).toBeNull();
  });

  it("refuses past 200 characters", () => {
    expect(MAX_PASSWORD_LENGTH).toBe(200);
    expect(passwordProblem("a7#".repeat(66) + "zz")).toBeNull();
    expect(passwordProblem("a7#".repeat(67))?.code).toBe("weak_password");
  });

  it("refuses the most common passwords, whatever their case", () => {
    expect(COMMON_PASSWORDS.size).toBeGreaterThan(1000);
    expect(passwordProblem("password")?.error).toMatch(/common/);
    expect(passwordProblem("PASSWORD1")?.code).toBe("weak_password");
    expect(passwordProblem("12345678")?.code).toBe("weak_password");
    expect(passwordProblem("qwertyuiop")?.code).toBe("weak_password");
  });

  it("refuses anything that is not a string", () => {
    expect(passwordProblem(undefined)?.code).toBe("weak_password");
    expect(passwordProblem(12345678)?.code).toBe("weak_password");
    expect(passwordProblem(["password1"])?.code).toBe("weak_password");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases, the way Google's addresses are stored", () => {
    expect(normalizeEmail("  Coach.Smith@Example.COM ")).toBe("coach.smith@example.com");
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "no-at-sign", "a@b", "two@@example.com", "spa ce@example.com", null, 42, `${"a".repeat(250)}@example.com`]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });
});
