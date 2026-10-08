// Server only: reading a request body with a real size limit.

// =============================================================================
// A `content-length` check alone is not a limit: a chunked request leaves the
// header out, and nothing makes a client tell the truth in it. These read the
// body stream themselves, counting bytes as they arrive, and stop the moment
// it passes the limit, so a route never holds more than `maxBytes` of
// somebody's upload in memory. The header is still checked first, as a fast
// way to turn away an honest large upload before reading any of it.
//
// Lives with the spend guards (lib/usage/) because a body that is too big is
// one of the ways one request becomes a large bill.
// =============================================================================

export type BodyRead<T> = { kind: "ok"; value: T } | { kind: "too_large" } | { kind: "unreadable" };

/** The body's bytes, or "too_large" once more than maxBytes have arrived (or are declared). */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<BodyRead<Uint8Array>> {
  const declared = request.headers.get("content-length");
  if (declared !== null && declared.trim() !== "") {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) return { kind: "too_large" };
  }
  if (!request.body) return { kind: "ok", value: new Uint8Array(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop reading; whatever else the client sends is dropped.
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", value: bytes };
}

/** The body parsed as JSON, within maxBytes. Bad JSON is "unreadable". */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyRead<unknown>> {
  const read = await readBodyBytes(request, maxBytes);
  if (read.kind !== "ok") return read;
  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder().decode(read.value)) };
  } catch {
    return { kind: "unreadable" };
  }
}

/**
 * A multipart (or urlencoded) body as FormData, within maxBytes: read into a
 * capped buffer first, then parsed from it with the request's own content type.
 */
export async function readFormBody(request: Request, maxBytes: number): Promise<BodyRead<FormData>> {
  const read = await readBodyBytes(request, maxBytes);
  if (read.kind !== "ok") return read;
  const contentType = request.headers.get("content-type");
  if (!contentType) return { kind: "unreadable" };
  try {
    const form = await new Response(new Blob([read.value as Uint8Array<ArrayBuffer>]), {
      headers: { "content-type": contentType },
    }).formData();
    return { kind: "ok", value: form };
  } catch {
    return { kind: "unreadable" };
  }
}
