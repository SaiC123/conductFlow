import { describe, it, expect, beforeAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NotAMemberError, assignTaskTo } from "@/lib/tasks/assign";
import { removeMember } from "@/lib/orgs/members";
import { clientFor, makeUser, makeWorkspace, serviceClient, type Workspace } from "../orgs/fixtures";

let service: SupabaseClient;
beforeAll(() => { service = serviceClient(); });

/** A task needs a commitment, and a commitment needs a conversation. Build the chain once. */
async function makeTask(ws: Workspace, ownerName: string | null = "Tutor"): Promise<string> {
  const { data: conversation, error: conversationError } = await service.from("conversation")
    .insert({ org_id: ws.orgId, title: "Assignment fixture" }).select("id").single();
  if (conversationError) throw conversationError;

  const { data: commitment, error: commitmentError } = await service.from("commitment").insert({
    org_id: ws.orgId, conversation_id: conversation.id, text: "Send the revised deck",
    owner: ownerName, confidence: "high",
  }).select("id").single();
  if (commitmentError) throw commitmentError;

  const { data: task, error: taskError } = await service.from("task").insert({
    org_id: ws.orgId, commitment_id: commitment.id, title: "Send the revised deck",
    owner_name: ownerName,
  }).select("id").single();
  if (taskError) throw taskError;
  return task.id as string;
}

async function ownerUserOf(taskId: string): Promise<string | null> {
  const { data } = await service.from("task").select("owner_user_id").eq("id", taskId).single();
  return (data?.owner_user_id as string | null) ?? null;
}

describe("assignTaskTo", () => {
  it("hands a task to a member of the org", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws);

    await assignTaskTo(await clientFor(ws.member.id), {
      taskId, userId: ws.member.id, actorUserId: ws.member.id });
    expect(await ownerUserOf(taskId)).toBe(ws.member.id);
  });

  it("lets any member assign, not only an owner — handing work over is ordinary work", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws);

    await assignTaskTo(await clientFor(ws.member.id), {
      taskId, userId: ws.owner.id, actorUserId: ws.member.id });
    expect(await ownerUserOf(taskId)).toBe(ws.owner.id);
  });

  it("takes an assignment off again", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws);
    const db = await clientFor(ws.owner.id);

    await assignTaskTo(db, { taskId, userId: ws.member.id, actorUserId: ws.owner.id });
    await assignTaskTo(db, { taskId, userId: null, actorUserId: ws.owner.id });
    expect(await ownerUserOf(taskId)).toBeNull();
  });

  it("leaves the name the transcript used alone", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws, "Tutor");

    await assignTaskTo(await clientFor(ws.owner.id), {
      taskId, userId: ws.member.id, actorUserId: ws.owner.id });

    const { data } = await service.from("task").select("owner_name").eq("id", taskId).single();
    expect(data!.owner_name).toBe("Tutor");
  });

  it("refuses to assign work to somebody outside the organization", async () => {
    const ws = await makeWorkspace(service);
    const stranger = await makeUser(service, "stranger");
    const taskId = await makeTask(ws);

    await expect(assignTaskTo(await clientFor(ws.owner.id), {
      taskId, userId: stranger.id, actorUserId: ws.owner.id,
    })).rejects.toBeInstanceOf(NotAMemberError);
    expect(await ownerUserOf(taskId)).toBeNull();
  });

  it("refuses somebody outside the organization touching the task at all", async () => {
    const ws = await makeWorkspace(service);
    const elsewhere = await makeWorkspace(service);
    const taskId = await makeTask(ws);

    await expect(assignTaskTo(await clientFor(elsewhere.owner.id), {
      taskId, userId: elsewhere.owner.id, actorUserId: elsewhere.owner.id,
    })).rejects.toThrow(/not found/i);
    expect(await ownerUserOf(taskId)).toBeNull();
  });

  it("audits who was given what", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws);
    await assignTaskTo(await clientFor(ws.owner.id), {
      taskId, userId: ws.member.id, actorUserId: ws.owner.id });

    const { data } = await service.from("audit_event").select("id")
      .eq("org_id", ws.orgId).eq("target", `task:${taskId}:assign:${ws.member.id}`);
    expect(data!).toHaveLength(1);
  });
});

describe("the assignee is always a member, not merely a member at the time", () => {
  it("drops the assignment when the person is removed from the org", async () => {
    const ws = await makeWorkspace(service);
    const taskId = await makeTask(ws);
    const db = await clientFor(ws.owner.id);

    await assignTaskTo(db, { taskId, userId: ws.member.id, actorUserId: ws.owner.id });
    await removeMember(db, { orgId: ws.orgId, userId: ws.member.id, actorUserId: ws.owner.id });

    // Left alone it would read on the board as though somebody is dealing with it.
    expect(await ownerUserOf(taskId)).toBeNull();
  });

  it("holds against a direct PostgREST update, not only against the app", async () => {
    const ws = await makeWorkspace(service);
    const elsewhere = await makeWorkspace(service);
    const taskId = await makeTask(ws);

    const { error } = await (await clientFor(ws.owner.id)).from("task")
      .update({ owner_user_id: elsewhere.member.id }).eq("id", taskId);
    expect(error?.code).toBe("23514");
  });
});
