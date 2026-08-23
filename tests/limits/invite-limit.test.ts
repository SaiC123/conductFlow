import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INVITE_BURST, INVITE_DAILY, REDEEM_BURST, REDEEM_GLOBAL,
  consumeInviteBudget, consumeRedemptionBudget, guardInviteBudget, guardRedemptionBudget,
} from "@/lib/limits/invite-limit";
import { RateLimited } from "@/lib/limits/rate-limit";
import { GLOBAL_SUBJECT } from "@/lib/limits/anon-rate-limit";
import { clientFor, join, makeOrg, makeUser, serviceClient } from "../orgs/fixtures";

let service: SupabaseClient;
let n = 0;
/** A subject nothing else in the suite counts against, so windows never collide. */
const freshSubject = () => `invite-test-${process.pid}-${n++}`;

beforeAll(() => { service = serviceClient(); });

/** An organization whose windows are untouched, and an owner's client to spend them from. */
async function freshOwner() {
  const orgId = await makeOrg(service, "Limit Co");
  const owner = await makeUser(service, "owner");
  await join(service, orgId, owner.id, "owner");
  return { orgId, owner, db: await clientFor(owner.id) };
}

describe("consumeInviteBudget", () => {
  it("allows an ordinary hour of inviting and then refuses", async () => {
    const { orgId, db } = await freshOwner();
    for (let i = 0; i < INVITE_BURST.max; i++) {
      await expect(consumeInviteBudget(db, orgId)).resolves.toBeUndefined();
    }
    await expect(consumeInviteBudget(db, orgId)).rejects.toBeInstanceOf(RateLimited);
  });

  it("bounds the day above the hour, so the two rules are not the same rule", () => {
    expect(INVITE_DAILY.max).toBeGreaterThan(INVITE_BURST.max);
    expect(INVITE_DAILY.windowSeconds).toBeGreaterThan(INVITE_BURST.windowSeconds);
    expect(INVITE_DAILY.bucket).not.toBe(INVITE_BURST.bucket);
  });

  it("refuses to spend an organization the caller is not a member of", async () => {
    const mine = await freshOwner();
    const theirs = await freshOwner();
    // consume_rate_limit's own membership check, from migration 0013. Without it an owner
    // could exhaust another organization's invite allowance by naming its id.
    await expect(consumeInviteBudget(mine.db, theirs.orgId)).rejects.toThrow(/not a member/i);
  });

  it("speaks to a person rather than throwing, when asked to guard", async () => {
    const { orgId, db } = await freshOwner();
    expect(await guardInviteBudget(db, orgId)).toBeNull();
    for (let i = 1; i < INVITE_BURST.max; i++) await consumeInviteBudget(db, orgId);

    const refused = await guardInviteBudget(db, orgId);
    expect(refused?.error).toMatch(/invitation/i);
    expect(refused?.error).not.toMatch(/model budget/i);
  });
});

describe("consumeRedemptionBudget", () => {
  it("bounds one address's attempts at guessing a link", async () => {
    const subject = freshSubject();
    for (let i = 0; i < REDEEM_BURST.max; i++) {
      await expect(consumeRedemptionBudget(service, subject)).resolves.toBeUndefined();
    }
    await expect(consumeRedemptionBudget(service, subject))
      .rejects.toBeInstanceOf(RateLimited);
  });

  it("charges the global rule even when the address could not be hashed", async () => {
    // The case a distributed attempt arranges for on purpose: no usable address, so every
    // per-address rule passes and only the global one is left holding the line.
    const before = await globalRemaining();
    await consumeRedemptionBudget(service, null);
    expect(await globalRemaining()).toBe(before - REDEEM_GLOBAL.cost);
  });

  it("keeps its own counter, separate from the waitlist's", () => {
    expect(REDEEM_GLOBAL.bucket).not.toBe("waitlist_all");
    expect(REDEEM_BURST.bucket).not.toBe("waitlist");
  });

  it("returns a refusal a landing page can render", async () => {
    const subject = freshSubject();
    expect(await guardRedemptionBudget(service, subject)).toBeNull();
    for (let i = 1; i < REDEEM_BURST.max; i++) await consumeRedemptionBudget(service, subject);

    const refused = await guardRedemptionBudget(service, subject);
    expect(refused?.error).toMatch(/too many/i);
  });

  it("does not need the redeemer to be anybody in particular", async () => {
    // A stranger holding a link has no org and no membership, so the org-keyed limiter of
    // 0013 cannot be the one guarding this path. This is the check that it is not.
    const subject = randomUUID();
    await expect(consumeRedemptionBudget(service, subject)).resolves.toBeUndefined();
  });
});

/**
 * The counter table is granted to nobody, so a window is read the only way it can be: a
 * zero-cost charge, which returns what is left without moving it. Same trick as the waitlist
 * suite.
 */
async function globalRemaining(): Promise<number> {
  const { data, error } = await service.rpc("consume_anon_rate_limit", {
    p_subject: GLOBAL_SUBJECT, p_bucket: REDEEM_GLOBAL.bucket,
    p_window_seconds: REDEEM_GLOBAL.windowSeconds, p_limit: REDEEM_GLOBAL.max, p_cost: 0,
  });
  if (error) throw error;
  return data[0].remaining as number;
}
