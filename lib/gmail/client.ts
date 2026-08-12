const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Every Gmail URL this codebase knows. Two entries: create a draft, read a draft back.
 * Adding a third would be a diff a reviewer cannot miss, and a test asserts the shape.
 */
export const GMAIL_ENDPOINTS = {
  createDraft: `${API_BASE}/drafts`,
  getDraft: `${API_BASE}/drafts/{id}`,
} as const;

export type GmailErrorKind =
  | "invalid_grant" | "unauthorized" | "forbidden" | "rate_limited" | "server_error" | "unknown";

export class GmailError extends Error {
  readonly kind: GmailErrorKind = "unknown";
  readonly status: number;
  readonly retryable: boolean = false;

  constructor(message: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** The grant is gone from the Google account. Reconnecting is the only fix. */
export class GmailInvalidGrantError extends GmailError {
  readonly kind = "invalid_grant" as const;
}

/** Access token rejected — expired or malformed. A refresh may fix it. */
export class GmailUnauthorizedError extends GmailError {
  readonly kind = "unauthorized" as const;
}

/** Authenticated, but the granted scopes do not cover this call. */
export class GmailForbiddenError extends GmailError {
  readonly kind = "forbidden" as const;
}

export class GmailRateLimitError extends GmailError {
  readonly kind = "rate_limited" as const;
  readonly retryable = true;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message, status);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class GmailServerError extends GmailError {
  readonly kind = "server_error" as const;
  readonly retryable = true;
}

export interface GmailClient {
  createDraft(raw: string): Promise<{ draftId: string; messageId: string }>;
  getDraft(draftId: string): Promise<{ exists: boolean }>;
}

export interface GmailClientOptions {
  /** Injected for tests; production uses the global. */
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

function retryAfterFrom(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : null;
}

/**
 * Google's own message, when it has one. Guessing at the cause hides real ones: a 403 is
 * just as often "the Gmail API is not enabled in this project" as it is a missing scope,
 * and the two need entirely different fixes.
 */
function reasonFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error?.message;
    return typeof message === "string" && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

/** Google reports a withdrawn grant as `invalid_grant` under either 401 or 403. */
function errorFor(status: number, body: string, headers: Headers): GmailError {
  const reason = reasonFrom(body);
  if (body.includes("invalid_grant")) {
    return new GmailInvalidGrantError("The Google connection was revoked or expired.", status);
  }
  if (status === 401) {
    return new GmailUnauthorizedError(reason ?? "Gmail rejected the access token.", status);
  }
  if (status === 403) {
    return new GmailForbiddenError(reason ?? "Gmail refused this call.", status);
  }
  if (status === 429) {
    return new GmailRateLimitError("Gmail is throttling this account.", status, retryAfterFrom(headers));
  }
  if (status >= 500) return new GmailServerError("Gmail is having trouble.", status);
  return new GmailError(`Gmail refused the request (HTTP ${status}).`, status);
}

const DEFAULT_MAX_RETRIES = 2;

/**
 * The only module that constructs a Gmail URL. The access token stays in memory for the
 * life of the request and never reaches an error message or a log line.
 */
export function createGmailClient(
  accessToken: string, options: GmailClientOptions = {},
): GmailClient {
  const call = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  async function request(url: string, init: RequestInit): Promise<Response> {
    let attempt = 0;
    for (;;) {
      const response = await call(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      });
      if (response.ok || response.status === 404) return response;

      const body = await response.text();
      const failure = errorFor(response.status, body, response.headers);
      if (!failure.retryable || attempt >= maxRetries) throw failure;

      const backoffMs = failure instanceof GmailRateLimitError && failure.retryAfterSeconds !== null
        ? failure.retryAfterSeconds * 1000
        : 2 ** attempt * 500;
      await wait(backoffMs);
      attempt++;
    }
  }

  return {
    async createDraft(raw: string) {
      const response = await request(GMAIL_ENDPOINTS.createDraft, {
        method: "POST",
        body: JSON.stringify({ message: { raw } }),
      });
      if (response.status === 404) {
        throw new GmailError("Gmail could not accept the draft (HTTP 404).", 404);
      }
      const payload = await response.json() as { id?: string; message?: { id?: string } };
      if (!payload.id) throw new GmailError("Gmail returned a draft with no id.", response.status);
      return { draftId: payload.id, messageId: payload.message?.id ?? "" };
    },

    async getDraft(draftId: string) {
      const response = await request(
        GMAIL_ENDPOINTS.getDraft.replace("{id}", encodeURIComponent(draftId)),
        { method: "GET" },
      );
      return { exists: response.status !== 404 };
    },
  };
}
