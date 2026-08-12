import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { bootstrapUser } from "@/lib/auth/bootstrap";

const URL = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const seededOwner = "00000000-0000-0000-0000-0000000000a1";
const seededOrg = "00000000-0000-0000-0000-00000000000a";

let db: SupabaseClient;
beforeAll(() => { db = createClient(URL, SERVICE, { auth: { persistSession: false } }); });

describe("bootstrapUser", () => {
  it("gives a brand-new user their own org as owner", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, email: "ana@example.test", fullName: "Ana Ruiz" });
    expect(r.created).toBe(true);

    const { data: membership } = await db.from("membership")
      .select("role,org_id").eq("user_id", id).single();
    expect(membership!.role).toBe("owner");
    expect(membership!.org_id).toBe(r.orgId);

    const { data: org } = await db.from("organization").select("name").eq("id", r.orgId).single();
    expect(org!.name).toBe("Ana Ruiz's workspace");
  });

  it("names the org from the email when Google sent no display name", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, email: "solo@example.test", fullName: null });
    const { data: org } = await db.from("organization").select("name").eq("id", r.orgId).single();
    expect(org!.name).toBe("solo's workspace");
  });

  it("mirrors the user into app_user", async () => {
    const id = randomUUID();
    await bootstrapUser(db, { id, email: "mirror@example.test" });
    const { data } = await db.from("app_user").select("email").eq("id", id).single();
    expect(data!.email).toBe("mirror@example.test");
  });

  it("is idempotent — a second sign-in does not create a second org", async () => {
    const id = randomUUID();
    const first = await bootstrapUser(db, { id, email: "twice@example.test" });
    const second = await bootstrapUser(db, { id, email: "twice@example.test" });
    expect(second.created).toBe(false);
    expect(second.orgId).toBe(first.orgId);

    const { data } = await db.from("membership").select("id").eq("user_id", id);
    expect(data!).toHaveLength(1);
  });

  it("leaves an existing member in their current org", async () => {
    const r = await bootstrapUser(db, { id: seededOwner, email: "owner@demo.test" });
    expect(r.created).toBe(false);
    expect(r.orgId).toBe(seededOrg);
  });

  it("writes an audit row for the org it created", async () => {
    const id = randomUUID();
    const r = await bootstrapUser(db, { id, email: "audited@example.test" });
    const { data } = await db.from("audit_event").select("*")
      .eq("target", `organization:${r.orgId}:bootstrap`);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("human");
    expect(data![0].action).toBe("create");
  });
});
