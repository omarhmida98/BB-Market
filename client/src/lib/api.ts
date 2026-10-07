import i18n from "@/lib/i18n";
import type { TFunction } from "i18next";

/**
 * A non-2xx answer from our own API, carrying the parsed body as well as the
 * raw text.
 *
 * Routes answer with `{ message }`, `{ code, counts }` or a plain sentence, and
 * the raw response text alone cannot tell those apart: the caller would show a
 * toast full of JSON (which is exactly what the admin panel used to do) and a
 * counted, structured error like a refused category delete would be
 * unrecoverable.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, raw: string) {
    super(raw);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** `message` when the route sent JSON, otherwise undefined. */
  get detail(): string | undefined {
    const body = this.body as { message?: unknown } | null;
    return body && typeof body.message === "string" ? body.message : undefined;
  }

  /** `code` for the errors that are identified structurally, not by sentence. */
  get code(): string | undefined {
    const body = this.body as { code?: unknown } | null;
    return body && typeof body.code === "string" ? body.code : undefined;
  }

  /** Parsed payload of a structured error, e.g. `{ counts }` on a refused delete. */
  get payload(): Record<string, any> | null {
    return this.body && typeof this.body === "object" ? (this.body as Record<string, any>) : null;
  }
}

/**
 * JSON fetch with `credentials: "include"`.
 *
 * Same contract as before - resolve with the parsed body, reject with an
 * `Error` - except that the rejection is an `ApiError`, so a caller that wants
 * the status or a structured field can still reach it.
 */
export async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...options });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const raw = (await res.text()) || `HTTP ${res.status}`;
    let body: unknown = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body, raw);
  }
  return res.json();
}

/**
 * The sentence to show a person for a failed API call.
 *
 * The server cannot know the reader's language, so the errors it wants
 * translated arrive as i18n keys (`admin.homepage_error_title_required`) and are
 * resolved here; a real driver or proxy message is passed through untouched so
 * nobody ever sees a raw key at the operator.
 */
export function apiErrorMessage(error: unknown, t: TFunction, fallback = ""): string {
  let message = "";
  if (error instanceof ApiError) {
    message = error.detail ?? error.message;
  } else {
    const raw = error instanceof Error ? error.message : String(error ?? "");
    message = raw;
    // Anything still handing us the raw response text (a hook that fetches on
    // its own) is unwrapped rather than shown as JSON.
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof (parsed as { message?: unknown }).message === "string") {
        message = (parsed as { message: string }).message;
      }
    } catch {
      // not JSON - already readable
    }
  }
  if (message && i18n.exists(message)) return t(message);
  return message || fallback;
}
