import type { SupabaseClient } from "@supabase/supabase-js";
import { openRefreshToken, sealRefreshToken, type SealedToken } from "./vault";
import { logAudit } from "@/lib/audit/log";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** No grant, a revoked grant, or a grant that never included the scope being asked for. */
export class DataSourceUnavailable extends Error {
  constructor(message: string, readonly reason: "missing" | "revoked" | "scope" | "refused") {
    super(message);
    this.name = "DataSourceUnavailable";
  }
}

export interface TokenDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CachedToken { accessToken: string; expiresAtMs: number }

// Access tokens live an hour and are never persisted — storing them would double the
// secret surface to save a little latency. Process memory is enough.
const cache = new Map<string, CachedToken>();

/** Exported for tests; a process restart clears this anyway. */
export function clearTokenCache() { cache.clear(); }

export function aadFor(orgId: string, provider: string, externalAccountId: string): string {
  return `${orgId}:${provider}:${externalAccountId}`;
}

const EXPIRY_MARGIN_MS = 60_000;

/**
 * Hands a caller a usable Google access token, refreshing when the cached one is close to
 * expiry. Every call is audited: a token whose use cannot be explained to a customer is
 * worse than no token.
 *
 * `db` must be a service-role client — `connected_data_source` is granted to nobody else.
 */
export async function getAccessToken(
  db: SupabaseClient, orgId: string, requiredScope: string, deps: TokenDeps = {},
): Promise<string> {
  const now = deps.now?.() ?? Date.now();

  const { data: row, error } = await db.from("connected_data_source")
    .select("id,org_id,provider,external_account_id,scopes,state,token_sealed,dek_sealed")
    .eq("org_id", orgId).eq("provider", "google").maybeSingle();
  if (error) throw error;
  if (!row) throw new DataSourceUnavailable("No Google account is connected.", "missing");
  if (row.state !== "active")
    throw new DataSourceUnavailable(`The Google connection is ${row.state}.`, "revoked");

  // Asking for a scope the user never granted is a bug in the caller, not a prompt to
  // re-consent behind their back.
  if (!(row.scopes as string[]).includes(requiredScope))
    throw new DataSourceUnavailable(`The connected account did not grant ${requiredScope}.`, "scope");

  await logAudit({
    orgId, actor: "agent", action: "read",
    target: `data_source:${row.id}:${requiredScope}`,
  });

  const cached = cache.get(row.id as string);
  if (cached && cached.expiresAtMs - now > EXPIRY_MARGIN_MS) return cached.accessToken;

  const refreshToken = openRefreshToken(
    { tokenSealed: row.token_sealed as string, dekSealed: row.dek_sealed as string },
    aadFor(row.org_id as string, row.provider as string, row.external_account_id as string),
  );

  const refreshed = await refreshAccessToken(refreshToken, deps);
  if (!refreshed.ok) {
    // A refusal here is usually a revoked grant, and it stays visible on the settings
    // screen rather than failing silently on every later call.
    await db.from("connected_data_source")
      .update({ state: "error", last_error: refreshed.error, updated_at: new Date(now).toISOString() })
      .eq("id", row.id);
    throw new DataSourceUnavailable(refreshed.error, "refused");
  }

  cache.set(row.id as string, {
    accessToken: refreshed.accessToken,
    expiresAtMs: now + refreshed.expiresInSeconds * 1000,
  });

  await db.from("connected_data_source").update({
    access_token_expires_at: new Date(now + refreshed.expiresInSeconds * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  }).eq("id", row.id);

  await logAudit({
    orgId, actor: "agent", action: "update",
    target: `data_source:${row.id}:refresh`,
  });

  return refreshed.accessToken;
}

type RefreshOutcome =
  | { ok: true; accessToken: string; expiresInSeconds: number }
  | { ok: false; error: string };

async function refreshAccessToken(
  refreshToken: string, deps: TokenDeps,
): Promise<RefreshOutcome> {
  const doFetch = deps.fetchImpl ?? fetch;
  const response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof body?.error === "string" ? body.error : `HTTP ${response.status}`;
    return { ok: false, error: `Google refused the refresh: ${detail}` };
  }
  if (typeof body?.access_token !== "string")
    return { ok: false, error: "Google returned no access token." };

  return {
    ok: true,
    accessToken: body.access_token,
    expiresInSeconds: typeof body.expires_in === "number" ? body.expires_in : 3600,
  };
}

export interface StoreGrantArgs {
  orgId: string;
  accountEmail: string;
  externalAccountId: string;
  refreshToken: string;
  scopes: string[];
  connectedBy: string | null;
  accessTokenExpiresAt?: string | null;
}

/**
 * Upserts the org's grant. Scopes are stored as Google actually granted them, never as
 * they were requested — a user can uncheck a box on the consent screen.
 */
export async function storeGrant(db: SupabaseClient, args: StoreGrantArgs): Promise<string> {
  const aad = aadFor(args.orgId, "google", args.externalAccountId);
  const sealed: SealedToken = sealRefreshToken(args.refreshToken, aad);

  const { data, error } = await db.from("connected_data_source").upsert({
    org_id: args.orgId, provider: "google",
    account_email: args.accountEmail, external_account_id: args.externalAccountId,
    scopes: args.scopes,
    token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed,
    kek_version: sealed.kekVersion,
    access_token_expires_at: args.accessTokenExpiresAt ?? null,
    state: "active", last_error: null,
    connected_by: args.connectedBy, updated_at: new Date().toISOString(),
  }, { onConflict: "org_id,provider,external_account_id" }).select("id").single();
  if (error) throw error;

  cache.delete(data.id as string);
  await logAudit({
    orgId: args.orgId, actor: "human", action: "create",
    target: `data_source:${data.id}:connect`,
  });
  return data.id as string;
}
