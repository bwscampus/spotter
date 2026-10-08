import { describe, expect, it } from "vitest";
import { readBodyBytes, readFormBody, readJsonBody } from "@/lib/usage/body";

// Body limits that count real bytes (lib/usage/body.ts, docs/PRE_LAUNCH_AUDIT.md
// H2): a request that leaves out content-length, or lies in it, is held to the
// same limit as one that tells the truth.

/** A streamed request with no content-length, in `chunks` pieces of `size` bytes. Counts how many were pulled. */
function chunked(chunks: number, size: number, contentType = "application/json") {
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= chunks) {
        controller.close();
        return;
      }
      pulled++;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
  });
  const request = new Request("https://spotter.test/api/x", {
    method: "POST",
    body,
    headers: { "content-type": contentType },
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => pulled };
}

describe("readBodyBytes", () => {
  it("turns away a declared length past the limit without reading anything", async () => {
    const request = new Request("https://spotter.test/api/x", {
      method: "POST",
      body: "x".repeat(10),
      headers: { "content-length": "999999" },
    });
    expect(await readBodyBytes(request, 100)).toEqual({ kind: "too_large" });
    expect(request.bodyUsed).toBe(false);
  });

  it("stops a chunked body as soon as it passes the limit, and reads no further", async () => {
    const { request, pulled } = chunked(1000, 1024);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBodyBytes(request, 10 * 1024)).toEqual({ kind: "too_large" });
    expect(pulled()).toBeLessThanOrEqual(12);
  });

  it("returns every byte of a body within the limit, exactly at it too", async () => {
    const { request } = chunked(4, 256);
    const read = await readBodyBytes(request, 1024);
    expect(read.kind).toBe("ok");
    if (read.kind === "ok") expect(read.value.byteLength).toBe(1024);
  });

  it("an empty body is empty, not an error", async () => {
    const read = await readBodyBytes(new Request("https://spotter.test/api/x", { method: "POST" }), 10);
    expect(read).toEqual({ kind: "ok", value: new Uint8Array(0) });
  });
});

describe("readJsonBody", () => {
  it("parses JSON within the limit", async () => {
    const request = new Request("https://spotter.test/api/x", { method: "POST", body: JSON.stringify({ keyterms: ["Langan"] }) });
    expect(await readJsonBody(request, 1024)).toEqual({ kind: "ok", value: { keyterms: ["Langan"] } });
  });

  it("says bad JSON is unreadable and a big body is too large", async () => {
    expect(await readJsonBody(new Request("https://spotter.test/api/x", { method: "POST", body: "{nope" }), 1024)).toEqual({
      kind: "unreadable",
    });
    expect(await readJsonBody(chunked(10, 1024).request, 1024)).toEqual({ kind: "too_large" });
  });
});

describe("readFormBody", () => {
  it("parses a multipart upload from the capped buffer, files and fields alike", async () => {
    const form = new FormData();
    form.set("format", "pdf");
    form.set("roster_id", "abc");
    form.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "roster.pdf", { type: "application/pdf" }));
    const request = new Request("https://spotter.test/api/x", { method: "POST", body: form });

    const read = await readFormBody(request, 64 * 1024);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.value.get("format")).toBe("pdf");
    expect(read.value.get("roster_id")).toBe("abc");
    const file = read.value.get("file");
    expect(file).toBeInstanceOf(File);
    expect(new Uint8Array(await (file as File).arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it("refuses a multipart body past the limit", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(8 * 1024)], "big.pdf"));
    const request = new Request("https://spotter.test/api/x", { method: "POST", body: form });
    expect(await readFormBody(request, 1024)).toEqual({ kind: "too_large" });
  });

  it("says a body that is not a form is unreadable", async () => {
    const { request } = chunked(1, 10, "multipart/form-data; boundary=nothing");
    expect(await readFormBody(request, 1024)).toEqual({ kind: "unreadable" });
  });
});
