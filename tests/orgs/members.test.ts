import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LastOwnerError, changeMemberRole, createInvite, listMembers, listPendingInvites,
  removeMember, revokeInvite,
} from "@/lib/orgs/members";
import { hashInviteToken } from "@/lib/orgs/invite";
import {
  clientFor, join, makeOrg, makeUser, makeWorkspace, roleOf, serviceClient,
} from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;

let service: SupabaseClient;
beforeAll(() => { service = serviceClient(); });

describe("listMembers", () => {
  it("lists everyone in the org with their role and address, owners first", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const rows = await listMembers(await clientFor(owner.id), orgId);

    expect(rows.map((r) => r.email)).toEqual([owner.email, member.email]);
    expect(rows.map((r) => r.role)).toEqual(["owner", "member"]);
    expect(rows[0].userId).toBe(owner.id);
  });

  it("shows a member the roster too — assigning work needs names", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const rows = await listMembers(await clientFor(member.id), orgId);
    expect(rows.map((r) => r.userId).sort()).toEqual([owner.id, member.id].sort());
  });

  it("shows an outsider nothing at all", async () => {
    const { orgId } = await makeWorkspace(service);
    const stranger = await makeUser(service, "stranger");
    expect(await listMembers(await clientFor(stranger.id), orgId)).toEqual([]);
  });
});

describe("createInvite", () => {
  it("returns a token to show once and stores only its digest", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    const { token, invite } = await createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id });

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite.email).toBe("ada@example.test");

    const { data } = await service.from("org_invite")
      .select("token_hash,state,role").eq("id", invite.id).single();
    expect(data!.token_hash).toBe(hashInviteToken(token));
    expect(data!.token_hash).not.toContain(token);
    expect(data!.state).toBe("pending");
  });

  it("refuses a member trying to invite anyone", async () => {
    const { orgId, member } = await makeWorkspace(service);
    const db = await clientFor(member.id);
    await expect(createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: member.id,
    })).rejects.toMatchObject({ code: "42501" });
  });

  it("refuses an owner of another org inviting into this one", async () => {
    const { orgId } = await makeWorkspace(service);
    const elsewhere = await makeWorkspace(service);
    const db = await clientFor(elsewhere.owner.id);
    await expect(createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: elsewhere.owner.id,
    })).rejects.toMatchObject({ code: "42501" });
  });

  it("replaces an outstanding invite to the same address rather than doubling it", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    const first = await createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id });
    const second = await createInvite(db, {
      orgId, email: "ada@example.test", role: "owner", invitedBy: owner.id });

    expect(second.invite.id).not.toBe(first.invite.id);
    const { data } = await service.from("org_invite").select("id,state").eq("org_id", orgId);
    expect(data!.find((r) => r.id === first.invite.id)!.state).toBe("revoked");
    expect(data!.find((r) => r.id === second.invite.id)!.state).toBe("pending");
  });

  it("does not let a long-dead invite block a fresh one", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    const stale = await createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id,
      now: new Date(Date.now() - 30 * DAY) });

    const fresh = await createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id });

    const { data } = await service.from("org_invite").select("id,state").eq("org_id", orgId);
    expect(data!.find((r) => r.id === stale.invite.id)!.state).toBe("expired");
    expect(data!.find((r) => r.id === fresh.invite.id)!.state).toBe("pending");
  });

  it("audits who invited whom, without the address", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    const { invite } = await createInvite(db, {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id });

    const { data } = await service.from("audit_event").select("*")
      .eq("org_id", orgId).eq("target", `org_invite:${invite.id}:create`);
    expect(data!).toHaveLength(1);
    expect(JSON.stringify(data![0])).not.toContain("ada@example.test");
  });
});

describe("listPendingInvites", () => {
  it("lists what is still live and nothing else", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    await createInvite(db, { orgId, email: "live@example.test", role: "member",
      invitedBy: owner.id });
    const dead = await createInvite(db, { orgId, email: "dead@example.test", role: "member",
      invitedBy: owner.id, now: new Date(Date.now() - 30 * DAY) });
    const revoked = await createInvite(db, { orgId, email: "gone@example.test",
      role: "member", invitedBy: owner.id });
    await revokeInvite(db, { orgId, inviteId: revoked.invite.id, actorUserId: owner.id });

    const rows = await listPendingInvites(db, orgId);
    expect(rows.map((r) => r.email)).toEqual(["live@example.test"]);
    expect(rows.map((r) => r.id)).not.toContain(dead.invite.id);
  });

  it("never hands a digest back to the browser", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    await createInvite(db, { orgId, email: "ada@example.test", role: "member",
      invitedBy: owner.id });

    const rows = await listPendingInvites(db, orgId);
    expect(JSON.stringify(rows)).not.toMatch(/token/i);
  });

  it("shows a member nothing, because invites are an owner's business", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await createInvite(await clientFor(owner.id), { orgId, email: "ada@example.test",
      role: "member", invitedBy: owner.id });

    expect(await listPendingInvites(await clientFor(member.id), orgId)).toEqual([]);
  });
});

describe("revokeInvite", () => {
  it("takes a live link out of service and audits it", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    const { invite } = await createInvite(db, { orgId, email: "ada@example.test",
      role: "member", invitedBy: owner.id });

    await revokeInvite(db, { orgId, inviteId: invite.id, actorUserId: owner.id });

    const { data } = await service.from("org_invite").select("state").eq("id", invite.id).single();
    expect(data!.state).toBe("revoked");

    const { data: audit } = await service.from("audit_event").select("id")
      .eq("target", `org_invite:${invite.id}:revoke`);
    expect(audit!).toHaveLength(1);
  });

  it("refuses a member", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const { invite } = await createInvite(await clientFor(owner.id), {
      orgId, email: "ada@example.test", role: "member", invitedBy: owner.id });

    await expect(revokeInvite(await clientFor(member.id), {
      orgId, inviteId: invite.id, actorUserId: member.id })).rejects.toThrow(/not found/i);

    const { data } = await service.from("org_invite").select("state").eq("id", invite.id).single();
    expect(data!.state).toBe("pending");
  });
});

describe("changeMemberRole", () => {
  it("promotes a member to owner", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await changeMemberRole(await clientFor(owner.id), {
      orgId, userId: member.id, role: "owner", actorUserId: owner.id });
    expect(await roleOf(service, orgId, member.id)).toBe("owner");
  });

  it("demotes a second owner", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    await changeMemberRole(db, { orgId, userId: member.id, role: "owner",
      actorUserId: owner.id });
    await changeMemberRole(db, { orgId, userId: owner.id, role: "member",
      actorUserId: owner.id });
    expect(await roleOf(service, orgId, owner.id)).toBe("member");
  });

  it("will not demote the last owner", async () => {
    const { orgId, owner } = await makeWorkspace(service);
    await expect(changeMemberRole(await clientFor(owner.id), {
      orgId, userId: owner.id, role: "member", actorUserId: owner.id,
    })).rejects.toBeInstanceOf(LastOwnerError);
    expect(await roleOf(service, orgId, owner.id)).toBe("owner");
  });

  it("refuses a member changing anyone's role, including their own", async () => {
    const { orgId, member } = await makeWorkspace(service);
    const db = await clientFor(member.id);
    await expect(changeMemberRole(db, {
      orgId, userId: member.id, role: "owner", actorUserId: member.id,
    })).rejects.toThrow(/not found/i);
    expect(await roleOf(service, orgId, member.id)).toBe("member");
  });

  it("audits the change", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await changeMemberRole(await clientFor(owner.id), {
      orgId, userId: member.id, role: "owner", actorUserId: owner.id });

    const { data } = await service.from("audit_event").select("id")
      .eq("org_id", orgId).eq("target", `membership:${member.id}:role:owner`);
    expect(data!).toHaveLength(1);
  });
});

describe("removeMember", () => {
  it("takes a member's access away", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await removeMember(await clientFor(owner.id), {
      orgId, userId: member.id, actorUserId: owner.id });
    expect(await roleOf(service, orgId, member.id)).toBeNull();
  });

  it("leaves the person's account and their history alone", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await removeMember(await clientFor(owner.id), {
      orgId, userId: member.id, actorUserId: owner.id });

    const { data } = await service.from("app_user").select("email").eq("id", member.id).single();
    expect(data!.email).toBe(member.email);

    const { data: audit } = await service.from("audit_event").select("id")
      .eq("org_id", orgId).eq("target", `membership:${member.id}:remove`);
    expect(audit!).toHaveLength(1);
  });

  it("will not remove the last owner", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    await removeMember(db, { orgId, userId: member.id, actorUserId: owner.id });

    await expect(removeMember(db, { orgId, userId: owner.id, actorUserId: owner.id }))
      .rejects.toBeInstanceOf(LastOwnerError);
    expect(await roleOf(service, orgId, owner.id)).toBe("owner");
  });

  it("removes an owner once a second owner exists", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    const db = await clientFor(owner.id);
    await changeMemberRole(db, { orgId, userId: member.id, role: "owner",
      actorUserId: owner.id });
    await removeMember(db, { orgId, userId: owner.id, actorUserId: owner.id });
    expect(await roleOf(service, orgId, owner.id)).toBeNull();
  });

  it("refuses a member removing anybody", async () => {
    const { orgId, owner, member } = await makeWorkspace(service);
    await expect(removeMember(await clientFor(member.id), {
      orgId, userId: owner.id, actorUserId: member.id })).rejects.toThrow(/not found/i);
    expect(await roleOf(service, orgId, owner.id)).toBe("owner");
  });

  it("refuses an owner of one org reaching into another", async () => {
    const here = await makeWorkspace(service);
    const there = await makeWorkspace(service);
    await expect(removeMember(await clientFor(there.owner.id), {
      orgId: here.orgId, userId: here.member.id, actorUserId: there.owner.id,
    })).rejects.toThrow(/not found/i);
    expect(await roleOf(service, here.orgId, here.member.id)).toBe("member");
  });
});

describe("the last-owner guard is the database's, not the app's", () => {
  it("holds against a direct PostgREST update", async () => {
    const orgId = await makeOrg(service);
    const owner = await makeUser(service, "solo");
    await join(service, orgId, owner.id, "owner");

    const db = await clientFor(owner.id);
    const { error } = await db.from("membership").update({ role: "member" })
      .eq("org_id", orgId).eq("user_id", owner.id);
    expect(error?.code).toBe("23514");
  });

  it("holds against a direct PostgREST delete", async () => {
    const orgId = await makeOrg(service);
    const owner = await makeUser(service, "solo");
    await join(service, orgId, owner.id, "owner");

    const db = await clientFor(owner.id);
    const { error } = await db.from("membership").delete()
      .eq("org_id", orgId).eq("user_id", owner.id);
    expect(error?.code).toBe("23514");
  });
});
