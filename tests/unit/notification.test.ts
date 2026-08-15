import { describe, expect, it } from "vitest";

import { NotificationType } from "@/generated/prisma/enums";
import {
  CONFIGURABLE_NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NOTIFICATION_TYPE_LABELS,
  deadlineReminderFor,
  describeReminder,
  isConfigurableNotificationType,
  parseMentions,
  type MentionCandidate,
} from "@/lib/domain/notification";

const TEAM: MentionCandidate[] = [
  { id: "m-john", name: "John" },
  { id: "m-john-smith", name: "John Smith" },
  { id: "m-mary", name: "Mary O'Brien" },
  { id: "m-ann", name: "Ann" },
];

describe("notification type metadata", () => {
  it("labels and describes every type", () => {
    for (const type of Object.values(NotificationType)) {
      expect(NOTIFICATION_TYPE_LABELS[type], type).toBeTruthy();
      expect(NOTIFICATION_TYPE_DESCRIPTIONS[type], type).toBeTruthy();
    }
  });

  it("makes every type configurable except SYSTEM", () => {
    expect(CONFIGURABLE_NOTIFICATION_TYPES).toHaveLength(
      Object.values(NotificationType).length - 1,
    );
    expect(isConfigurableNotificationType(NotificationType.SYSTEM)).toBe(false);
    expect(isConfigurableNotificationType(NotificationType.MENTION)).toBe(true);
  });
});

describe("parseMentions", () => {
  it("finds a plain mention", () => {
    expect(parseMentions("thanks @Ann", TEAM)).toEqual(["m-ann"]);
  });

  it("returns nothing when there is no @ at all", () => {
    expect(parseMentions("Ann should look at this", TEAM)).toEqual([]);
  });

  it("prefers the longest matching name", () => {
    // The whole point: with both "John" and "John Smith" on the team,
    // @John Smith must reach John Smith and must NOT also ping John.
    expect(parseMentions("@John Smith please review", TEAM)).toEqual([
      "m-john-smith",
    ]);
  });

  it("still matches the short name on its own", () => {
    expect(parseMentions("@John please review", TEAM)).toEqual(["m-john"]);
  });

  it("does not match a name that is only a prefix of a longer word", () => {
    expect(parseMentions("@Announcement time", TEAM)).toEqual([]);
    expect(parseMentions("@Johnson is not on the team", TEAM)).toEqual([]);
  });

  it("matches at the very end of the body", () => {
    expect(parseMentions("over to @Ann", TEAM)).toEqual(["m-ann"]);
  });

  it("accepts trailing punctuation as a boundary", () => {
    expect(parseMentions("@Ann, can you?", TEAM)).toEqual(["m-ann"]);
    expect(parseMentions("(cc @Ann)", TEAM)).toEqual(["m-ann"]);
    expect(parseMentions("@Ann.", TEAM)).toEqual(["m-ann"]);
  });

  it("is case-insensitive", () => {
    expect(parseMentions("@ANN and @john smith", TEAM)).toEqual(
      expect.arrayContaining(["m-ann", "m-john-smith"]),
    );
  });

  it("handles a name containing an apostrophe", () => {
    expect(parseMentions("@Mary O'Brien owns this", TEAM)).toEqual(["m-mary"]);
  });

  it("mentions each person at most once however often they are written", () => {
    expect(parseMentions("@Ann @Ann @Ann", TEAM)).toEqual(["m-ann"]);
  });

  it("finds several distinct people", () => {
    const found = parseMentions("@Ann and @John Smith", TEAM);
    expect(found).toHaveLength(2);
    expect(new Set(found)).toEqual(new Set(["m-ann", "m-john-smith"]));
  });

  it("ignores an unknown name", () => {
    expect(parseMentions("@Nobody here", TEAM)).toEqual([]);
  });

  it("ignores a blank candidate name rather than matching every @", () => {
    // A member whose name is empty would otherwise turn a bare "@" into a
    // mention of them, on every comment anyone writes.
    const withBlank = [...TEAM, { id: "m-blank", name: "  " }];
    expect(parseMentions("email me @ the office", withBlank)).toEqual([]);
  });

  it("does not match an email address as a mention", () => {
    // "@Ann" appears inside "team@Annex.com", but the character after it is a
    // letter, so the boundary rule rejects it.
    expect(parseMentions("write to team@Annex.com", TEAM)).toEqual([]);
  });
});

describe("deadlineReminderFor", () => {
  const WINDOW = 3;

  it("returns nothing for a task with no computable days remaining", () => {
    // computeDaysRemaining is null for a closed task or one with no due date.
    expect(deadlineReminderFor(null, WINDOW)).toBeNull();
  });

  it("returns nothing beyond the window", () => {
    expect(deadlineReminderFor(4, WINDOW)).toBeNull();
    expect(deadlineReminderFor(30, WINDOW)).toBeNull();
  });

  it("treats the window edge as due soon", () => {
    expect(deadlineReminderFor(3, WINDOW)).toEqual({
      kind: "due-soon",
      daysRemaining: 3,
    });
  });

  it("treats today as due soon, not overdue", () => {
    expect(deadlineReminderFor(0, WINDOW)).toEqual({
      kind: "due-soon",
      daysRemaining: 0,
    });
  });

  it("reports overdue once the date has passed", () => {
    expect(deadlineReminderFor(-1, WINDOW)).toEqual({
      kind: "overdue",
      daysOverdue: 1,
    });
    expect(deadlineReminderFor(-12, WINDOW)).toEqual({
      kind: "overdue",
      daysOverdue: 12,
    });
  });

  it("honours a widened window", () => {
    expect(deadlineReminderFor(7, 3)).toBeNull();
    expect(deadlineReminderFor(7, 10)).toEqual({
      kind: "due-soon",
      daysRemaining: 7,
    });
  });

  it("honours a zero window — only today qualifies", () => {
    expect(deadlineReminderFor(0, 0)).toEqual({
      kind: "due-soon",
      daysRemaining: 0,
    });
    expect(deadlineReminderFor(1, 0)).toBeNull();
  });
});

describe("describeReminder", () => {
  it("uses singular wording for one day", () => {
    expect(describeReminder({ kind: "overdue", daysOverdue: 1 })).toBe(
      "1 day overdue",
    );
    expect(describeReminder({ kind: "due-soon", daysRemaining: 1 })).toBe(
      "Due tomorrow",
    );
  });

  it("names today rather than counting zero days", () => {
    expect(describeReminder({ kind: "due-soon", daysRemaining: 0 })).toBe(
      "Due today",
    );
  });

  it("uses plural wording otherwise", () => {
    expect(describeReminder({ kind: "overdue", daysOverdue: 5 })).toBe(
      "5 days overdue",
    );
    expect(describeReminder({ kind: "due-soon", daysRemaining: 3 })).toBe(
      "Due in 3 days",
    );
  });
});
