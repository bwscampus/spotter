import { describe, expect, it } from "vitest";
import { baseFontPx, BIG_LINE_SIZES, fitBigLine, HERO_WIDTH_EM, SMALL_GAP_EM, SMALL_SCALE, STAGE_HEIGHT_EM, STAGE_WIDTH_EM, TEXT_COLUMN_EM, type Measure } from "@/lib/cards/bigLine";
import { cardFace, splitRespelling, titleCase } from "@/lib/cards/cardFace";
import { schoolCode, schoolCodes, sideLook, slabInk } from "@/lib/game/colors";

// The card's text rules (docs/CARD_SPEC.md), all pure and all worked out when
// the game is built, never when a card is written. Made-up names throughout.

describe("the slab's ink", () => {
  it("is #111111 on a light colour and #FFFFFF on a dark one, split at luminance 0.179", () => {
    expect(slabInk("#FFB612")).toBe("#111111");
    expect(slabInk("#0B2545")).toBe("#FFFFFF");
    expect(slabInk("#E6E6E6")).toBe("#111111");
    expect(slabInk("#111111")).toBe("#FFFFFF");
  });

  it("falls back to a dark home slab and a light grey away one when the team has no colour", () => {
    expect(sideLook(null, "H", "")).toMatchObject({ background: "#111111", ink: "#FFFFFF", hatch: "" });
    expect(sideLook(null, "A", "EST")).toMatchObject({ background: "#E6E6E6", ink: "#111111", code: "EST" });
    expect(sideLook(null, "A", "EST").hatch).toContain("rgba(17, 17, 17, 0.12)");
  });
});

describe("the school code", () => {
  it("is the initials of up to three words, skipping High, School, HS, of and the", () => {
    expect(schoolCode("Castellan Prep")).toBe("CP");
    expect(schoolCode("Harborview High School")).toBe("HAR");
    expect(schoolCode("The Academy of Saint Brennock")).toBe("ASB");
    expect(schoolCode("North Millbrook Valley Christian")).toBe("NMV");
  });

  it("is the first three letters of a one-word school", () => {
    expect(schoolCode("Estancia")).toBe("EST");
    expect(schoolCode("Estancia HS")).toBe("EST");
  });

  it("uses the first three letters of each school's first word when both come out the same", () => {
    expect(schoolCodes("Castellan Prep", "Corvain Prep")).toEqual({ home: "CAS", away: "COR" });
    expect(schoolCodes("Castellan Prep", "Estancia")).toEqual({ home: "CP", away: "EST" });
  });
});

describe("the respelling", () => {
  it("splits once around the first run of two or more capitals", () => {
    expect(splitRespelling("kwell-en-BAHK")).toEqual({ before: "kwell-en-", stressed: "BAHK", after: "" });
    expect(splitRespelling("oh-soo-EH-tuh")).toEqual({ before: "oh-soo-", stressed: "EH", after: "-tuh" });
  });

  it("lowercases the rest, and with no capital run the whole note is before", () => {
    expect(splitRespelling("Kwell-en-bahk")).toEqual({ before: "kwell-en-bahk", stressed: "", after: "" });
    expect(splitRespelling("da-REE-Oh")).toEqual({ before: "da-", stressed: "REE", after: "-oh" });
  });

  it("is not a respelling past 24 characters or with anything but letters, hyphens, spaces and apostrophes", () => {
    expect(splitRespelling("o'MAR-a")).not.toBeNull();
    expect(splitRespelling("kwell en BAHK")).not.toBeNull();
    expect(splitRespelling("rhymes-with-marquetto-not")).toBeNull();
    expect(splitRespelling("KWELL (like well)")).toBeNull();
    expect(splitRespelling("kwell/en/BAHK")).toBeNull();
    expect(splitRespelling("   ")).toBeNull();
  });
});

describe("Title case", () => {
  it("converts a name saved in ALL CAPS, after a space, hyphen or apostrophe too", () => {
    expect(titleCase("QUELLENBACH")).toBe("Quellenbach");
    expect(titleCase("O'BRANNIGAN")).toBe("O'Brannigan");
    expect(titleCase("VANDERKELLEN-RUIZ")).toBe("Vanderkellen-Ruiz");
    expect(titleCase("DE LA FUENTEVILLA")).toBe("De La Fuentevilla");
  });

  it("leaves any name with a lowercase letter as saved, and never forces capitals", () => {
    expect(titleCase("McTavisher")).toBe("McTavisher");
    expect(titleCase("de la Fuentevilla")).toBe("de la Fuentevilla");
    expect(titleCase("quellenbach")).toBe("quellenbach");
  });
});

describe("the big line's fit", () => {
  // A made-up font: every character 0.5em wide, a bold one 0.55em.
  const measure: Measure = (text, weight, spacing) => [...text].length * ((weight >= 700 ? 0.55 : 0.5) + spacing);
  const face = (surname: string) => cardFace({ jersey: "1", first_name: null, last_name: surname, position: null, pronunciations: [] });

  it("has a column of what the slab and stats leave", () => {
    expect(TEXT_COLUMN_EM).toBeCloseTo(13.5);
    expect(BIG_LINE_SIZES).toEqual([1.8, 1.55, 1.3]);
  });

  it("stays whole at full size when it fits", () => {
    expect(fitBigLine(face("Quellenbach"), measure)).toMatchObject({ plain: "Quellenbach", size: 1.8 });
  });

  it("breaks once after the hyphen, keeping it on the first line", () => {
    expect(fitBigLine(face("Vanderkellen-Ruiz"), measure)).toMatchObject({ plain: "Vanderkellen-\nRuiz", size: 1.8 });
  });

  it("breaks at a space, which goes", () => {
    expect(fitBigLine(face("Fuentevillalobos Arce"), measure)).toMatchObject({ plain: "Fuentevillalobos\nArce", size: 1.3 });
  });

  it("steps down a size, then another, when a break is not enough, and never smaller", () => {
    expect(fitBigLine(face("Quellenbachson"), measure)).toMatchObject({ plain: "Quellenbachson", size: 1.55 });
    expect(fitBigLine(face("Quellenbachsford"), measure)).toMatchObject({ plain: "Quellenbachsford", size: 1.3 });
    const longest = fitBigLine(face("Quellenbachersfordington"), measure);
    expect(longest.size).toBe(BIG_LINE_SIZES[BIG_LINE_SIZES.length - 1]);
    expect(longest.plain).toBe("Quellenbachersfordington");
  });

  it("breaks a respelling inside its parts, where the two lines come out most even, and keeps the stress", () => {
    const respelled = cardFace({ jersey: "1", first_name: "Dario", last_name: "Q", position: null, pronunciations: ["vahn-der-KELL-en-roo-eez"] });
    const fit = fitBigLine(respelled, measure);
    expect([fit.before, fit.stressed, fit.after]).toEqual(["vahn-der-", "KELL", "-\nen-roo-eez"]);
    expect(fit.size).toBe(1.8);
  });
});

describe("the stage", () => {
  it("fits the wide hero and, under it, the two older cards side by side, exactly as wide", () => {
    expect(2 * HERO_WIDTH_EM * SMALL_SCALE + SMALL_GAP_EM).toBeCloseTo(HERO_WIDTH_EM);
    expect(STAGE_WIDTH_EM).toBe(33);
    expect(STAGE_HEIGHT_EM).toBeCloseTo(11.075, 2);
  });

  it("has a base size that is the floor of the smaller of width over 36 (33 and 3em to move across) and height over 11.075", () => {
    expect(baseFontPx(1440, 700)).toBe(40);
    expect(baseFontPx(1100, 300)).toBe(27);
    expect(baseFontPx(0, 0)).toBe(1);
  });
});
