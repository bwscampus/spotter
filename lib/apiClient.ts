// The browser's one way to call Spotter's own API: JSON in, JSON out, same
// origin (so the session cookie rides along and the routes' same-origin check
// passes). Never throws: a network failure is { ok: false, status: 0 }.

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string | null; code: string | null };

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data: payload as T };
    const fields = (payload ?? {}) as { error?: unknown; code?: unknown };
    return {
      ok: false,
      status: response.status,
      error: typeof fields.error === "string" ? fields.error : null,
      code: typeof fields.code === "string" ? fields.code : null,
    };
  } catch {
    return { ok: false, status: 0, error: null, code: null };
  }
}
