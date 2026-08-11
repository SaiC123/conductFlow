import { describe, it, expect } from "vitest";
import { canTransition, TASK_STATES, type TaskStatus } from "@/lib/tasks/transitions";

describe("canTransition", () => {
  it("moves a task forward through the lifecycle", () => {
    expect(canTransition("open", "in_progress").ok).toBe(true);
    expect(canTransition("in_progress", "done").ok).toBe(true);
  });

  it("allows finishing a task nobody started", () => {
    expect(canTransition("open", "done").ok).toBe(true);
  });

  it("allows correcting a premature start", () => {
    expect(canTransition("in_progress", "open").ok).toBe(true);
  });

  it("reopens a completed task to open, not to in_progress", () => {
    expect(canTransition("done", "open").ok).toBe(true);
    const blocked = canTransition("done", "in_progress");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toMatch(/reopen/i);
  });

  it("rejects a move to the state it is already in", () => {
    for (const s of TASK_STATES) {
      const r = canTransition(s, s);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/already/i);
    }
  });

  it("rejects a state that is not a task state", () => {
    const r = canTransition("open", "archived" as TaskStatus);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unknown/i);
  });
});
