import { describe, expect, it } from "vitest";
import {
  queueCommands,
  threadCommand,
  waitingSince,
} from "../lib/channels/threadCommand";
import {
  expectationInstruction,
  handoffNoticeText,
  noticeReason,
} from "../lib/escalation/handoffNotice";

const NOW = 1_800_000_000_000;

describe("who is in command of a conversation", () => {
  it("names the AI only when nothing is holding it back", () => {
    expect(threadCommand({ automationMode: "bot" }, NOW)).toMatchObject({ who: "ai", reason: null, aiActive: true });
    expect(threadCommand({}, NOW)).toMatchObject({ who: "ai", aiActive: true });
    // A tenant with no live agent has nobody answering, and saying "AI" there
    // would claim a robot is handling conversations nobody is handling.
    expect(threadCommand({ aiAvailable: false }, NOW)).toMatchObject({ who: "nobody", aiActive: true });
  });

  it("puts the strongest lock first, because the reason decides the button", () => {
    // Opt-out beats a member lock: handing back would not undo it, so no
    // resumable button is offered.
    expect(
      threadCommand({ dnd: true, automationMode: "human", responsibleMemberId: "m1" }, NOW),
    ).toMatchObject({ who: "member", reason: "opted_out", resumable: false });
    expect(threadCommand({ openHumanCaseId: "c1" }, NOW)).toMatchObject({
      who: "waiting",
      reason: "human_case_open",
      resumable: false,
    });
    // Snoozed comes back on its own, so there is nothing to hand back.
    expect(threadCommand({ snoozedUntil: NOW + 60_000 }, NOW)).toMatchObject({ reason: "snoozed", resumable: false });
    expect(threadCommand({ snoozedUntil: NOW - 60_000 }, NOW)).toMatchObject({ who: "ai", reason: null });
    expect(threadCommand({ responsibleMemberId: "m1", automationMode: "human" }, NOW)).toMatchObject({
      who: "member",
      reason: "member_in_command",
      resumable: true,
    });
    expect(threadCommand({ automationMode: "stopped" }, NOW)).toMatchObject({ reason: "paused", resumable: true });
  });

  it("closed is absence of subject, not silence", () => {
    const closed = threadCommand({ closedAt: NOW - 1, responsibleMemberId: "m1" }, NOW);
    // The owner survives closing: on the "closed" tab, "who handled this?" is
    // the only question that matters.
    expect(closed).toMatchObject({ who: "member", reason: null, aiActive: false, resumable: false });
  });

  it("the queue asks for the AI's conversations only when no agent is live", () => {
    expect(queueCommands(true)).toEqual(["waiting", "nobody"]);
    expect(queueCommands(undefined)).toEqual(["waiting", "nobody"]);
    expect(queueCommands(false)).toContain("ai");
  });

  it("waiting starts at the patient's last message", () => {
    expect(waitingSince({ lastInboundAt: 10, createdAt: 5 })).toBe(10);
    expect(waitingSince({ createdAt: 5 })).toBe(5);
  });
});

describe("the hand-off notice", () => {
  it("maps the open reason vocabulary onto the four that change the sentence", () => {
    expect(noticeReason("human_request")).toBe("asked_human");
    expect(noticeReason("ai_opt_out")).toBe("suspected_opt_out");
    expect(noticeReason("BUDGET_EXCEEDED")).toBe("ai_budget");
    expect(noticeReason("provider_unavailable")).toBe("other");
    expect(noticeReason(undefined)).toBe("other");
  });

  it("never promises contact the clinic cannot deliver", () => {
    const empty = { available: 0, total: 0 };
    const busy = { available: 0, total: 3 };
    const ready = { available: 2, total: 3 };
    for (const availability of [empty, busy]) {
      const text = handoffNoticeText({ reason: "human_request", availability, conversationKey: "258840000001", locale: "pt" });
      expect(text).toContain("ficou registado");
      expect(text).not.toContain("a seguir");
    }
    expect(handoffNoticeText({ reason: "human_request", availability: ready, conversationKey: "258840000001", locale: "pt" })).toContain("a seguir");
  });

  it("answers an opt-out with confirmation, never with a waiting time", () => {
    const text = handoffNoticeText({
      reason: "ai_opt_out",
      availability: { available: 5, total: 5 },
      conversationKey: "258840000002",
      locale: "pt",
    });
    expect(text).toMatch(/autom[áa]tic/i);
    expect(text).not.toContain("atendido a seguir");
  });

  it("varies by conversation and is stable within one", () => {
    const of = (key: string) =>
      handoffNoticeText({ reason: "human_request", availability: { available: 1, total: 1 }, conversationKey: key, locale: "pt" });
    expect(of("aaa")).toBe(of("aaa"));
    const distinct = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(of));
    // Fixed text vetoes itself against the channel's anti-repetition window.
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("tells the model what it may promise, and warns when it may not", () => {
    expect(expectationInstruction({ available: 0, total: 0 }, "pt")).toContain("ATENÇÃO");
    expect(expectationInstruction({ available: 0, total: 4 }, "pt")).toContain("ATENÇÃO");
    expect(expectationInstruction({ available: 3, total: 4 }, "pt")).toContain("3");
    expect(expectationInstruction({ available: 3, total: 4 }, "en")).toContain("take over");
  });
});
