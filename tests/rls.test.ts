import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";

const URL = process.env.SUPABASE_URL!, ANON = process.env.SUPABASE_ANON_KEY!,
  SECRET = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET!);
const orgA = "00000000-0000-0000-0000-00000000000a";
const userA = "00000000-0000-0000-0000-0000000000a1";
const memberA = "00000000-0000-0000-0000-0000000000a2";
const userB = "00000000-0000-0000-0000-0000000000b1";

async function jwt(sub: string) {
  return new SignJWT({ sub, role: "authenticated" }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime("1h").sign(SECRET);
}
function client(token: string) {
  return createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

describe("RLS org isolation", () => {
  it("positive control: org A owner can read org A commitments", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("commitment").select("id").eq("org_id", orgA);
    expect(data).not.toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("user in org B cannot read org A commitments", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("commitment").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("anonymous callers are denied outright", async () => {
    const anon = createClient(URL, ANON);
    const { data, error } = await anon.from("commitment").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("user in org B cannot read org A transcripts", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("transcript").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A reminders", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("reminder").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A tasks", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("task").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("no role may delete a task — the record of a promise is not erasable", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("task").delete().eq("org_id", orgA);
    expect(error).not.toBeNull();
  });

  it("a signed-in owner cannot read the connected_data_source table at all", async () => {
    const a = client(await jwt(userA));
    const { data, error } = await a.from("connected_data_source").select("token_sealed");
    expect(data).toBeNull();
    // Granted to service_role only: key and ciphertext never share a trust context.
    expect(error?.code).toBe("42501");
  });

  it("an owner reads their connections through the view, which exposes no sealed material", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("connected_data_source_public").select("account_email,scopes,state");
    expect(error).toBeNull();

    const sealed = await a.from("connected_data_source_public").select("token_sealed");
    expect(sealed.error).not.toBeNull();
  });

  it("org A owner sees the phase 2 columns with their defaults", async () => {
    const a = client(await jwt(userA));
    const { data } = await a.from("transcript")
      .select("injection_flags,extraction_status,extraction_error").eq("org_id", orgA).limit(1);
    expect(data).not.toBeNull();
    expect(data![0].extraction_status).toBe("pending");
    expect(data![0].injection_flags).toEqual([]);
  });
});

describe("agent_blueprint is owner-only", () => {
  // The escalation this phase exists to close: a member rewrites the org's contract
  // through PostgREST, granting the agent an unattended Gmail push.
  it("a member cannot insert a blueprint row", async () => {
    const m = client(await jwt(memberA));
    const { error } = await m.from("agent_blueprint").insert({
      org_id: orgA, version: 9001,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("an owner can insert a blueprint row", async () => {
    const a = client(await jwt(userA));
    // Blueprints are append-only and nothing in this suite deletes, so a fixed version
    // number would collide with itself (23505) the second time the suite runs against a
    // database that was not reset. Claim the next free version at or above 9002 instead.
    const { data: highest } = await a.from("agent_blueprint").select("version")
      .eq("org_id", orgA).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = Math.max(9002, ((highest?.version as number | undefined) ?? 0) + 1);

    // Contents are deliberately identical to DEFAULT_BLUEPRINT. This row wins
    // loadBlueprint's ordering for org A from here on, and the suite never deletes, so
    // anything else would silently change what later stack-backed tests are allowed
    // to do. See the version-range note in the Phase 5 plan, Task 2.
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version,
      allowed_sources: ["transcript", "client_contact", "template"],
      permitted_actions: ["draft_recap", "draft_task_list", "draft_follow_up"],
      required_approvals: ["push_email_draft", "edit_crm", "create_internal_task",
        "propose_recurring_task"],
      escalation_conditions: ["complaint", "legal_concern", "missing_owner_or_deadline"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).toBeNull();
  });

  it("not even an owner may grant an unattended external action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9003,
      allowed_sources: ["transcript"],
      permitted_actions: ["push_email_draft"],
      required_approvals: [],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("not even an owner may name a hard-prohibited action", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("agent_blueprint").insert({
      org_id: orgA, version: 9004,
      allowed_sources: ["transcript"],
      permitted_actions: ["draft_recap"],
      required_approvals: ["send_external_email"],
      escalation_conditions: ["complaint"],
      success_metric: "follow_up_sent_within_24h",
      expires_in_minutes: 60,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");
  });

  it("user in org B cannot read org A blueprints", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("agent_blueprint").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A escalations", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("escalation").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });
});

describe("drive_template is org-scoped and never deleted", () => {
  // The suite never resets, and there is no delete path, so every insert claims a fresh id.
  const fileId = () => `picker-test-${crypto.randomUUID()}`;

  it("an org member records a picked file and reads it back", async () => {
    const a = client(await jwt(userA));
    const id = fileId();
    const { error } = await a.from("drive_template").insert({
      org_id: orgA, file_id: id, name: "Follow-up template", mime_type: "text/plain" });
    expect(error).toBeNull();

    const { data } = await a.from("drive_template").select("file_id,state").eq("file_id", id);
    expect(data).toHaveLength(1);
    expect(data![0].state).toBe("active");
  });

  it("user in org B cannot read org A's templates", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("drive_template").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("an outsider cannot attach a file to org A", async () => {
    const b = client(await jwt(userB));
    const { error } = await b.from("drive_template").insert({
      org_id: orgA, file_id: fileId(), name: "Planted template", mime_type: "text/plain" });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
  });

  it("no role may delete a template record — forgetting is a state change", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("drive_template").delete().eq("org_id", orgA);
    expect(error).not.toBeNull();
  });
});

describe("audit_event is append-only", () => {
  it("an org member can insert and read audit rows", async () => {
    const a = client(await jwt(userA));
    const { error } = await a.from("audit_event").insert({
      org_id: orgA, actor: "human", action: "read", target: "test:append-only" });
    expect(error).toBeNull();
  });

  it("no role may delete or update audit rows", async () => {
    const a = client(await jwt(userA));
    const del = await a.from("audit_event").delete().eq("org_id", orgA);
    expect(del.error).not.toBeNull();
    const upd = await a.from("audit_event").update({ target: "tampered" }).eq("org_id", orgA);
    expect(upd.error).not.toBeNull();
  });
});

describe("org_invite is owner-only, and its digests are nobody's", () => {
  // The table that decides who else gets to see a customer's transcripts. Every assertion
  // here is a way in that has to stay shut.
  const email = () => `rls-${crypto.randomUUID().slice(0, 8)}@example.test`;
  // A digest is unique in the table, as a digest of a fresh token always would be. Anything
  // fixed here collides with itself on the second insert.
  const digest = () => crypto.randomUUID().replace(/-/g, "").repeat(2);

  async function anInvite(role = "member") {
    const a = client(await jwt(userA));
    const address = email();
    const { data, error } = await a.from("org_invite").insert({
      org_id: orgA, email: address, role,
      token_hash: digest(), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    }).select("id").single();
    if (error) throw error;
    return { id: data!.id as string, email: address };
  }

  it("an owner can issue one and read it back", async () => {
    const a = client(await jwt(userA));
    const invite = await anInvite();
    const { data } = await a.from("org_invite").select("id,email,state").eq("id", invite.id);
    expect(data).toHaveLength(1);
    expect(data![0].state).toBe("pending");
  });

  it("a member cannot issue one", async () => {
    const m = client(await jwt(memberA));
    const { error } = await m.from("org_invite").insert({
      org_id: orgA, email: email(), role: "owner",
      token_hash: digest(), expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(error?.code).toBe("42501");
  });

  it("a member cannot read who has been invited", async () => {
    await anInvite();
    const m = client(await jwt(memberA));
    const { data } = await m.from("org_invite").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("user in org B cannot read org A's invites", async () => {
    await anInvite();
    const b = client(await jwt(userB));
    const { data } = await b.from("org_invite").select("id").eq("org_id", orgA);
    expect(data).toEqual([]);
  });

  it("not even the owner who issued it can read the token digest", async () => {
    // The link is the credential. A session that could read digests back could not replay
    // them either — but it is one preimage attack and one weak token away from mattering,
    // and there is no reason for a browser to hold them at all.
    const a = client(await jwt(userA));
    const invite = await anInvite();
    const { data, error } = await a.from("org_invite").select("token_hash").eq("id", invite.id);
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("an owner may revoke an invite but may not rewrite one", async () => {
    const a = client(await jwt(userA));
    const invite = await anInvite("member");

    const revoke = await a.from("org_invite").update({ state: "revoked" }).eq("id", invite.id);
    expect(revoke.error).toBeNull();

    // A link already in somebody's hands must not quietly become an owner invitation, or an
    // invitation to a different address, or one that never expires.
    for (const patch of [{ role: "owner" }, { email: "attacker@example.test" },
      { expires_at: "2099-01-01T00:00:00.000Z" }]) {
      const { error } = await a.from("org_invite").update(patch).eq("id", invite.id);
      expect(error?.code).toBe("42501");
    }
  });

  it("no role may delete an invite — how somebody got access is the record", async () => {
    const a = client(await jwt(userA));
    const invite = await anInvite();
    const { error } = await a.from("org_invite").delete().eq("id", invite.id);
    expect(error).not.toBeNull();
  });

  it("anonymous callers are denied outright", async () => {
    const anon = createClient(URL, ANON);
    const { data, error } = await anon.from("org_invite").select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("the roster is visible inside the org and nowhere else", () => {
  it("a member sees their colleagues' memberships", async () => {
    const m = client(await jwt(memberA));
    const { data } = await m.from("membership").select("user_id").eq("org_id", orgA);
    expect(data!.map((r) => r.user_id).sort()).toEqual([userA, memberA].sort());
  });

  it("a member sees their colleagues' addresses, and no one else's", async () => {
    const m = client(await jwt(memberA));
    const { data } = await m.from("app_user").select("id,email");
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(userA);
    expect(ids).toContain(memberA);
    expect(ids).not.toContain(userB);
  });

  it("user in org B sees nothing of org A's roster", async () => {
    const b = client(await jwt(userB));
    const { data } = await b.from("membership").select("user_id").eq("org_id", orgA);
    expect(data).toEqual([]);
    const { data: users } = await b.from("app_user").select("id").eq("id", userA);
    expect(users).toEqual([]);
  });

  it("a member cannot promote themselves", async () => {
    const m = client(await jwt(memberA));
    await m.from("membership").update({ role: "owner" })
      .eq("org_id", orgA).eq("user_id", memberA);

    const a = client(await jwt(userA));
    const { data } = await a.from("membership").select("role")
      .eq("org_id", orgA).eq("user_id", memberA).single();
    expect(data!.role).toBe("member");
  });

  it("a member cannot remove anybody", async () => {
    const m = client(await jwt(memberA));
    await m.from("membership").delete().eq("org_id", orgA).eq("user_id", userA);

    const a = client(await jwt(userA));
    const { data } = await a.from("membership").select("role")
      .eq("org_id", orgA).eq("user_id", userA).single();
    expect(data!.role).toBe("owner");
  });

  it("nobody may write themselves into an organization", async () => {
    // The one door in is an invitation, redeemed server-side. If this insert worked, every
    // check on that path would be decoration.
    const b = client(await jwt(userB));
    const { error } = await b.from("membership")
      .insert({ org_id: orgA, user_id: userB, role: "owner" });
    expect(error?.code).toBe("42501");

    const a = client(await jwt(userA));
    const { error: ownerToo } = await a.from("membership")
      .insert({ org_id: orgA, user_id: userB, role: "member" });
    expect(ownerToo?.code).toBe("42501");
  });
});

describe("a task belongs to a member or to nobody", () => {
  const commitmentA = "00000000-0000-0000-0000-0000000000f1";

  async function aTask(): Promise<string> {
    const a = client(await jwt(userA));
    const { data, error } = await a.from("task").insert({
      org_id: orgA, commitment_id: commitmentA, title: "RLS assignment fixture",
    }).select("id").single();
    if (error) throw error;
    return data!.id as string;
  }

  it("a member can hand a task to a colleague", async () => {
    const m = client(await jwt(memberA));
    const id = await aTask();
    const { error } = await m.from("task").update({ owner_user_id: userA }).eq("id", id);
    expect(error).toBeNull();
  });

  it("nobody can hand a task to somebody outside the org", async () => {
    // The cross-tenant edge of assignment: an outsider's address on a card is an outsider's
    // address disclosed to the org, and the org's work disclosed to them.
    const a = client(await jwt(userA));
    const id = await aTask();
    const { error } = await a.from("task").update({ owner_user_id: userB }).eq("id", id);
    expect(error?.code).toBe("23514");
  });

  it("user in org B cannot assign anything in org A", async () => {
    const id = await aTask();
    const b = client(await jwt(userB));
    const { data } = await b.from("task").update({ owner_user_id: userB })
      .eq("id", id).select("id");
    expect(data).toEqual([]);
  });
});
