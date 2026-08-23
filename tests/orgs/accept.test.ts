import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptInvite, previewInvite } from "@/lib/orgs/accept";
import { createInvite } from "@/lib/orgs/members";
import { newInviteToken } from "@/lib/orgs/invite";
import {
  clientFor, join, makeOrg, makeUser, makeWorkspace, roleOf, serviceClient, type Workspace,
} from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;

let service: SupabaseClient;
beforeAll(() => { service = serviceClient(); });

/** An invitation to `email`, issued by the workspace's owner exactly as the app issues one. */
async function invite(ws: Workspace, email: string, opts: {
  role?: "owner" | "member"; now?: Date } = {}) {
  return createInvite(await clientFor(ws.owner.id), {
    orgId: ws.orgId, email, role: opts.role ?? "member",
    invitedBy: ws.owner.id, now: opts.now,
  });
}

/** Somebody who has signed in but belongs to no organization yet. */
function newcomer(email: string) {
  return { id: randomUUID(), email };
}

describe("acceptInvite", () => {
  it("puts the invited person in the org at the role they were invited to", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "ada@example.test", { role: "owner" });
    const user = newcomer("ada@example.test");

    const result = await acceptInvite(service, { token, user });
    expect(result.ok).toBe(true);
    expect(result.ok && result.orgId).toBe(ws.orgId);
    expect(await roleOf(service, ws.orgId, user.id)).toBe("owner");
  });

  it("mirrors a first-time account into app_user on the way in", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "newcomer@example.test");
    const user = newcomer("newcomer@example.test");

    await acceptInvite(service, { token, user });
    const { data } = await service.from("app_user").select("email").eq("id", user.id).single();
    expect(data!.email).toBe("newcomer@example.test");
  });

  it("works exactly once", async () => {
    const ws = await makeWorkspace(service);
    const { token, invite: row } = await invite(ws, "ada@example.test");
    const user = newcomer("ada@example.test");

    expect((await acceptInvite(service, { token, user })).ok).toBe(true);

    const second = await acceptInvite(service, {
      token, user: newcomer("ada@example.test") });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe("used");

    const { data } = await service.from("org_invite").select("state,accepted_by")
      .eq("id", row.id).single();
    expect(data!.state).toBe("accepted");
    expect(data!.accepted_by).toBe(user.id);
  });

  it("refuses a token that names no invitation", async () => {
    const result = await acceptInvite(service, {
      token: newInviteToken(), user: newcomer("ada@example.test") });
    expect(result.ok === false && result.reason).toBe("unknown");
  });

  it("refuses a token that is not even the right shape", async () => {
    const result = await acceptInvite(service, {
      token: "../../etc/passwd", user: newcomer("ada@example.test") });
    expect(result.ok === false && result.reason).toBe("unknown");
  });

  it("refuses an invitation that has run out of time, and marks it so", async () => {
    const ws = await makeWorkspace(service);
    const { token, invite: row } = await invite(ws, "ada@example.test",
      { now: new Date(Date.now() - 30 * DAY) });

    const result = await acceptInvite(service, { token, user: newcomer("ada@example.test") });
    expect(result.ok === false && result.reason).toBe("expired");

    const { data } = await service.from("org_invite").select("state").eq("id", row.id).single();
    expect(data!.state).toBe("expired");
  });

  it("refuses an invitation the owner took back", async () => {
    const ws = await makeWorkspace(service);
    const { token, invite: row } = await invite(ws, "ada@example.test");
    await service.from("org_invite").update({ state: "revoked" }).eq("id", row.id);

    const user = newcomer("ada@example.test");
    const result = await acceptInvite(service, { token, user });
    expect(result.ok === false && result.reason).toBe("revoked");
    expect(await roleOf(service, ws.orgId, user.id)).toBeNull();
  });

  it("refuses an account whose address is not the one invited", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "ada@example.test");
    const impostor = newcomer("someone.else@example.test");

    const result = await acceptInvite(service, { token, user: impostor });
    expect(result.ok === false && result.reason).toBe("wrong_account");
    expect(await roleOf(service, ws.orgId, impostor.id)).toBeNull();
  });

  it("never repeats the invited address back to whoever is holding the link", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "ada@example.test");

    const result = await acceptInvite(service, {
      token, user: newcomer("someone.else@example.test") });
    expect(JSON.stringify(result)).not.toContain("ada@example.test");
  });

  it("does not care how the address is capitalised", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "ada@example.test");
    const user = newcomer("Ada@Example.Test");

    expect((await acceptInvite(service, { token, user })).ok).toBe(true);
    expect(await roleOf(service, ws.orgId, user.id)).toBe("member");
  });

  it("refuses an account that already belongs to another workspace", async () => {
    const elsewhere = await makeWorkspace(service);
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, elsewhere.member.email);

    const result = await acceptInvite(service, { token, user: elsewhere.member });
    expect(result.ok === false && result.reason).toBe("other_org");
    expect(await roleOf(service, ws.orgId, elsewhere.member.id)).toBeNull();
    // Their existing membership is untouched: a refused invitation costs them nothing.
    expect(await roleOf(service, elsewhere.orgId, elsewhere.member.id)).toBe("member");
  });

  it("is a no-op for somebody who is already in the org", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, ws.member.email, { role: "owner" });

    const result = await acceptInvite(service, { token, user: ws.member });
    expect(result.ok && result.alreadyMember).toBe(true);
    // The invitation is spent, and it did not silently promote them.
    expect(await roleOf(service, ws.orgId, ws.member.id)).toBe("member");
  });

  it("audits the join against the org that gained a member", async () => {
    const ws = await makeWorkspace(service);
    const { token, invite: row } = await invite(ws, "ada@example.test");
    const user = newcomer("ada@example.test");
    await acceptInvite(service, { token, user });

    const { data } = await service.from("audit_event").select("*")
      .eq("org_id", ws.orgId).eq("target", `org_invite:${row.id}:accept`);
    expect(data!).toHaveLength(1);
    expect(data![0].actor).toBe("human");
  });

  it("cannot be redeemed by a signed-in session reaching the table directly", async () => {
    // The whole reason redemption is a service_role job: org_invite is owner-only under RLS,
    // so the one person who needs to read this row is the one person who cannot.
    const ws = await makeWorkspace(service);
    const { invite: row } = await invite(ws, "ada@example.test");
    const outsider = await makeUser(service, "outsider");

    const db = await clientFor(outsider.id);
    const { data } = await db.from("org_invite").select("id").eq("id", row.id);
    expect(data).toEqual([]);

    const { error } = await db.from("membership")
      .insert({ org_id: ws.orgId, user_id: outsider.id, role: "owner" });
    expect(error?.code).toBe("42501");
  });
});

describe("previewInvite", () => {
  it("names the organization and the role, so the landing page means something", async () => {
    const orgId = await makeOrg(service, "Northwind Ltd");
    const owner = await makeUser(service, "owner");
    await join(service, orgId, owner.id, "owner");
    const { token } = await createInvite(await clientFor(owner.id), {
      orgId, email: "ada@example.test", role: "owner", invitedBy: owner.id });

    const result = await previewInvite(service, token);
    expect(result.ok && result.preview).toMatchObject({
      orgId, orgName: "Northwind Ltd", role: "owner" });
  });

  it("does not tell the holder of a link who it was addressed to", async () => {
    const ws = await makeWorkspace(service);
    const { token } = await invite(ws, "ada@example.test");
    const result = await previewInvite(service, token);
    expect(JSON.stringify(result)).not.toContain("ada@example.test");
  });

  it("reports the same refusals acceptance does", async () => {
    const ws = await makeWorkspace(service);
    const stale = await invite(ws, "stale@example.test",
      { now: new Date(Date.now() - 30 * DAY) });

    expect((await previewInvite(service, newInviteToken())).ok === false).toBe(true);
    const expired = await previewInvite(service, stale.token);
    expect(expired.ok === false && expired.reason).toBe("expired");
  });
});
