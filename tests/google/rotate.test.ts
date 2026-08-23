import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sealRefreshToken, openRefreshToken, type VaultKeys } from "@/lib/google/vault";
import { aadFor } from "@/lib/google/tokens";
import { rewrapDataSources } from "@/lib/google/rotate";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// A throwaway org per run, not one of the seeded two. Nothing in this product may delete a
// grant, so rows written here are permanent; scoping every rotation to an org that exists
// only for this file keeps the sweep small and keeps these rows out of the way of the other
// suites, which assert on the seeded orgs.
const org = randomUUID();
const DRIVE = "https://www.googleapis.com/auth/drive.file";

const oldKek = randomBytes(32);
const newKek = randomBytes(32);
const strayKek = randomBytes(32);

/** What the environment looks like mid-rotation: new key current, old key still readable. */
const during: VaultKeys = { kek: newKek, previous: oldKek, version: 2 };

let db: SupabaseClient;

/** Seeds one grant sealed under whichever key the test wants it stuck on. */
async function seed(externalAccountId: string, keys: VaultKeys, token: string) {
  const sealed = sealRefreshToken(token, aadFor(org, "google", externalAccountId), keys);
  const { data, error } = await db.from("connected_data_source").upsert({
    org_id: org, provider: "google", account_email: `${externalAccountId}@other.test`,
    external_account_id: externalAccountId, scopes: [DRIVE],
    token_sealed: sealed.tokenSealed, dek_sealed: sealed.dekSealed,
    kek_version: sealed.kekVersion, state: "active", connected_by: null,
  }, { onConflict: "org_id,provider,external_account_id" }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function read(id: string) {
  const { data, error } = await db.from("connected_data_source")
    .select("id,external_account_id,token_sealed,dek_sealed,kek_version,updated_at")
    .eq("id", id).single();
  if (error) throw error;
  return data!;
}

// Nothing in this product may delete a grant, so each test works on external ids that only
// it uses, and asserts on its own rows rather than on table-wide counts.
const unique = (name: string) => `${name}-${randomBytes(4).toString("hex")}`;

beforeAll(async () => {
  db = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { error } = await db.from("organization").insert({ id: org, name: "Rotation fixture" });
  if (error) throw error;
});

describe("rewrapDataSources", () => {
  it("re-seals a row left on the previous key, and the token survives it", async () => {
    const sub = unique("stale");
    const id = await seed(sub, { kek: oldKek, version: 1 }, "1//token-for-stale");
    const before = await read(id);

    const report = await rewrapDataSources(db, { orgId: org, keys: during });
    expect(report.rewrapped).toBeGreaterThanOrEqual(1);
    expect(report.failures.map((f) => f.id)).not.toContain(id);

    const after = await read(id);
    expect(after.kek_version).toBe(2);
    expect(after.dek_sealed).not.toBe(before.dek_sealed);
    // The refresh token was never re-encrypted; only its data key was re-wrapped.
    expect(after.token_sealed).toBe(before.token_sealed);

    // Opens with the incoming key alone, which is what makes retiring the old one safe.
    const plaintext = openRefreshToken(
      { tokenSealed: after.token_sealed as string, dekSealed: after.dek_sealed as string },
      aadFor(org, "google", sub), { kek: newKek });
    expect(plaintext).toBe("1//token-for-stale");
  });

  it("leaves a row already on the current key untouched", async () => {
    const sub = unique("current");
    const id = await seed(sub, during, "1//token-for-current");
    const before = await read(id);

    const report = await rewrapDataSources(db, { orgId: org, keys: during });
    expect(report.alreadyCurrent).toBeGreaterThanOrEqual(1);

    const after = await read(id);
    expect(after.dek_sealed).toBe(before.dek_sealed);
    expect(after.kek_version).toBe(2);
  });

  it("is idempotent: a second pass rewraps nothing", async () => {
    const id = await seed(unique("twice"), { kek: oldKek, version: 1 }, "1//token-for-twice");

    await rewrapDataSources(db, { orgId: org, keys: during });
    const second = await rewrapDataSources(db, { orgId: org, keys: during });
    expect(second.rewrapped).toBe(0);
    expect(second.failures.map((f) => f.id)).not.toContain(id);
    expect((await read(id)).kek_version).toBe(2);
  });

  it("does not disturb updated_at, which decides whose grant serves a scope", async () => {
    const id = await seed(unique("ordering"), { kek: oldKek, version: 1 }, "1//token-ordering");
    const before = await read(id);

    await rewrapDataSources(db, { orgId: org, keys: during });

    const after = await read(id);
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.kek_version).toBe(2);
  });

  it("skips a row it cannot open, leaving its ciphertext byte-identical", async () => {
    const id = await seed(unique("stray"), { kek: strayKek, version: 1 }, "1//token-for-stray");
    const before = await read(id);

    const report = await rewrapDataSources(db, { orgId: org, keys: during });

    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect(report.failures.map((f) => f.id)).toContain(id);

    const after = await read(id);
    expect(after.dek_sealed).toBe(before.dek_sealed);
    expect(after.token_sealed).toBe(before.token_sealed);
    expect(after.kek_version).toBe(1);
  });

  it("rewraps the rest of a batch even when one row in it is unopenable", async () => {
    const good = await seed(unique("beside"), { kek: oldKek, version: 1 }, "1//token-beside");
    await seed(unique("stray2"), { kek: strayKek, version: 1 }, "1//token-stray2");

    const report = await rewrapDataSources(db, { orgId: org, keys: during });
    expect(report.rewrapped).toBeGreaterThanOrEqual(1);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect((await read(good)).kek_version).toBe(2);
  });

  it("reports a skipped row without quoting anything sealed", async () => {
    const id = await seed(unique("quiet"), { kek: strayKek, version: 1 }, "1//token-for-quiet");
    const stored = await read(id);

    const report = await rewrapDataSources(db, { orgId: org, keys: during });
    const failure = report.failures.find((f) => f.id === id);

    expect(failure).toBeDefined();
    expect(failure!.reason).not.toContain("token-for-quiet");
    expect(failure!.reason).not.toContain(stored.dek_sealed as string);
    expect(failure!.reason).not.toContain(newKek.toString("base64"));
    expect(failure!.reason).not.toContain(strayKek.toString("base64"));
  });

  it("stops at maxRows and hands back a cursor that resumes where it stopped", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++)
      ids.push(await seed(unique(`batch-${i}`), { kek: oldKek, version: 1 }, `1//token-${i}`));

    const first = await rewrapDataSources(db, {
      orgId: org, keys: during, batchSize: 2, maxRows: 2,
    });
    expect(first.scanned).toBe(2);
    expect(first.done).toBe(false);
    expect(first.cursor).toBeTruthy();

    let cursor = first.cursor;
    let guard = 0;
    while (cursor && guard++ < 40) {
      const next = await rewrapDataSources(db, {
        orgId: org, keys: during, batchSize: 2, maxRows: 2, cursor,
      });
      cursor = next.cursor;
    }
    expect(cursor).toBeNull();

    for (const id of ids) expect((await read(id)).kek_version).toBe(2);
  });

  it("survives being interrupted: rows already done stay done", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++)
      ids.push(await seed(unique(`resume-${i}`), { kek: oldKek, version: 1 }, `1//resume-${i}`));

    const partial = await rewrapDataSources(db, {
      orgId: org, keys: during, batchSize: 1, maxRows: 1,
    });
    expect(partial.scanned).toBe(1);

    // A fresh run from the top, which is the shape of an operator retrying after a timeout.
    const full = await rewrapDataSources(db, { orgId: org, keys: during });
    expect(full.done).toBe(true);
    for (const id of ids) expect((await read(id)).kek_version).toBe(2);
  });

  it("writes an audit row naming every grant it rewrapped", async () => {
    const id = await seed(unique("audited"), { kek: oldKek, version: 1 }, "1//token-audited");
    await rewrapDataSources(db, { orgId: org, keys: during });

    const { data } = await db.from("audit_event").select("*")
      .eq("org_id", org).eq("target", `data_source:${id}:rewrap`);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("agent");
    expect(data![0].action).toBe("update");
  });

  it("writes an audit row for a grant it could not rewrap, so a half-run is visible", async () => {
    const id = await seed(unique("stray3"), { kek: strayKek, version: 1 }, "1//token-stray3");
    await rewrapDataSources(db, { orgId: org, keys: during });

    const { data } = await db.from("audit_event").select("*")
      .eq("org_id", org).eq("target", `data_source:${id}:rewrap-failed`);
    expect(data!.length).toBeGreaterThan(0);
    expect(data![0].action).toBe("update");
  });

  it("refuses a batch size outside what one invocation can finish", async () => {
    await expect(rewrapDataSources(db, { orgId: org, keys: during, batchSize: 0 }))
      .rejects.toThrow(/batchSize/);
    await expect(rewrapDataSources(db, { orgId: org, keys: during, batchSize: 5000 }))
      .rejects.toThrow(/batchSize/);
  });
});
