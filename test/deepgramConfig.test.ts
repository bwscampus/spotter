import { describe, expect, it } from "vitest";
import { buildKeytermCheckUrl, buildListenUrl, DEEPGRAM_MODEL } from "@/lib/deepgram/config";

describe("buildListenUrl", () => {
  it("still builds the URL the live socket has always used", () => {
    expect(buildListenUrl(16000, ["Fukuji", "Lin"])).toBe(
      "wss://api.deepgram.com/v1/listen?model=nova-3&interim_results=true&smart_format=false" +
        "&punctuate=false&numerals=true&encoding=linear16&sample_rate=16000&channels=1&mip_opt_out=true" +
        "&keyterm=Fukuji&keyterm=Lin",
    );
  });

  it("repeats the keyterm param rather than joining names", () => {
    const url = buildListenUrl(16000, ["Williams", "Sanchez-Greenfield"]);
    expect(url).toContain("keyterm=Williams");
    expect(url).toContain("keyterm=Sanchez-Greenfield");
    expect(url).not.toContain("Williams,");
  });

  it("sends no keyterm param at all when there are none", () => {
    expect(buildListenUrl(16000, [])).not.toContain("keyterm");
    expect(buildListenUrl(16000, ["", "  "])).not.toContain("keyterm");
  });
});

describe("numerals", () => {
  it("asks for numerals, which is what turns \"twenty three\" into one 23 token", () => {
    expect(new URL(buildListenUrl(16000, [])).searchParams.get("numerals")).toBe("true");
  });
});

describe("buildKeytermCheckUrl", () => {
  it("uses the pre-recorded endpoint with the same model and opt-out", () => {
    const url = new URL(buildKeytermCheckUrl(["Williams"]));
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
    expect(url.searchParams.get("model")).toBe(DEEPGRAM_MODEL);
    expect(url.searchParams.get("mip_opt_out")).toBe("true");
  });

  it("encodes keyterms exactly as the live URL does, so the two cannot drift", () => {
    const names = ["Williams", "O'Garro", "Sanchez-Greenfield", "de la Cruz"];
    const live = new URL(buildListenUrl(16000, names)).searchParams.getAll("keyterm");
    const check = new URL(buildKeytermCheckUrl(names)).searchParams.getAll("keyterm");
    expect(check).toEqual(live);
    expect(check).toEqual(names);
  });
});
