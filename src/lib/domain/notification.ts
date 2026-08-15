import { NotificationType } from "@/generated/prisma/enums";

/**
 * Notification rules — pure, no I/O.
 *
 * NET-NEW (audit §15). Legacy has **no notification layer of any kind**: it
 * was a spreadsheet, and "being told" meant someone looked at the Control
 * Center or an account manager sent an email. Nothing here is a port, so
 * nothing here may claim to be one — every rule below is a CoreWorks decision
 * and is justified where it is made.
 *
 * Delivery is in-app only. There is no mail transport in this codebase, so
 * this module never speaks of email; offering an email toggle for a channel
 * that does not exist would be a control that lies.
 */

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  TASK_ASSIGNED: "Task assigned to me",
  TASK_DUE_SOON: "My task is due soon",
  TASK_OVERDUE: "My task is overdue",
  ISSUE_ASSIGNED: "Issue assigned to me",
  REQUEST_ASSIGNED: "Client request assigned to me",
  CLIENT_HEALTH_CHANGED: "A client I own changes health",
  MENTION: "I am mentioned in a comment",
  SYSTEM: "System and scheduled-job notices",
};

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> =
  {
    TASK_ASSIGNED:
      "Someone assigns you a task, individually or as part of a bulk reassignment.",
    TASK_DUE_SOON:
      "The nightly pass finds one of your open tasks inside the organization's due-soon window.",
    TASK_OVERDUE:
      "The nightly pass finds one of your open tasks past its due date.",
    ISSUE_ASSIGNED: "Someone assigns you an issue, or raises one against you.",
    REQUEST_ASSIGNED: "Someone assigns you an outstanding client request.",
    CLIENT_HEALTH_CHANGED:
      "A client whose account manager or backup you are moves to a different health status.",
    MENTION: "Someone writes @your name in a comment.",
    SYSTEM:
      "Results of scheduled jobs, such as the monthly task generation run.",
  };

/**
 * Types a user may switch off.
 *
 * `SYSTEM` is deliberately absent. It carries operational outcomes — what the
 * monthly generation actually created — which the people who receive it are
 * accountable for. A mute that hides an unread failure would be worse than no
 * notification at all.
 */
export const CONFIGURABLE_NOTIFICATION_TYPES: readonly NotificationType[] =
  Object.values(NotificationType).filter(
    (type) => type !== NotificationType.SYSTEM,
  );

export function isConfigurableNotificationType(
  type: NotificationType,
): boolean {
  return CONFIGURABLE_NOTIFICATION_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export interface MentionCandidate {
  /** OrganizationMember id — what a notification is addressed through. */
  id: string;
  /** The user's display name, as it appears everywhere else in the app. */
  name: string;
}

/**
 * Finds the members mentioned in a comment body.
 *
 * The syntax is `@` immediately followed by a member's display name, matched
 * case-insensitively against the names supplied by the caller. There is no
 * separate mention handle: names are what the rest of the app shows, and
 * introducing a second identifier would mean two ways to refer to one person.
 *
 * Three rules make it predictable rather than clever:
 *
 *  1. **Longest name first.** With both "John" and "John Smith" on the team,
 *     `@John Smith` must reach John Smith, not John followed by stray text.
 *  2. **A match must end on a word boundary.** `@Johnson` does not mention
 *     John. Without this, every short name would be a false positive inside a
 *     longer one.
 *  3. **Each member at most once**, however many times they are written, so a
 *     comment cannot generate a pile of identical notifications.
 *
 * Deliberately NOT implemented: an autocomplete picker. This is plain-text
 * matching, and the comment box says so. A picker is a UI feature that would
 * change no rule here.
 */
export function parseMentions(
  body: string,
  candidates: readonly MentionCandidate[],
): string[] {
  if (!body.includes("@")) return [];

  const haystack = body.toLowerCase();

  const ordered = [...candidates]
    .filter((candidate) => candidate.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  const matched: string[] = [];
  const seen = new Set<string>();

  // Positions already consumed by a longer name, so "@John Smith" cannot also
  // register as a mention of "John".
  const consumed = new Set<number>();

  for (const candidate of ordered) {
    const needle = `@${candidate.name.trim().toLowerCase()}`;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;

      if (consumed.has(at)) continue;

      const after = haystack.charAt(at + needle.length);
      // End of string, or anything that is not a name character. Letters,
      // digits, and the characters names legitimately contain would mean the
      // match is a prefix of a longer word.
      if (after !== "" && !/[\s.,;:!?)\]}"'@]/.test(after)) continue;

      for (let i = at; i < at + needle.length; i += 1) consumed.add(i);

      if (!seen.has(candidate.id)) {
        seen.add(candidate.id);
        matched.push(candidate.id);
      }
    }
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Deadline reminders
// ---------------------------------------------------------------------------

export type DeadlineReminder =
  | { kind: "overdue"; daysOverdue: number }
  | { kind: "due-soon"; daysRemaining: number }
  | null;

/**
 * Which reminder, if any, an open task earns today.
 *
 * Overdue wins over due-soon — a task that is both is simply overdue — and
 * "due soon" spans today through `dueSoonDays` inclusive.
 *
 * The window is the organization's `HEALTH_AT_RISK_DUE_SOON_DAYS` setting
 * rather than a fresh constant. That is the horizon the health rule already
 * calls imminent (audit §6.1); a second, differently-tuned number would let
 * the sidebar and the client's health disagree about what "soon" means.
 */
export function deadlineReminderFor(
  daysRemaining: number | null,
  dueSoonDays: number,
): DeadlineReminder {
  if (daysRemaining === null) return null;
  if (daysRemaining < 0) return { kind: "overdue", daysOverdue: -daysRemaining };
  if (daysRemaining <= dueSoonDays) return { kind: "due-soon", daysRemaining };
  return null;
}

/** Wording for a reminder, so the job and its tests cannot phrase it differently. */
export function describeReminder(reminder: Exclude<DeadlineReminder, null>): string {
  if (reminder.kind === "overdue") {
    return reminder.daysOverdue === 1
      ? "1 day overdue"
      : `${reminder.daysOverdue} days overdue`;
  }
  if (reminder.daysRemaining === 0) return "Due today";
  return reminder.daysRemaining === 1 ? "Due tomorrow" : `Due in ${reminder.daysRemaining} days`;
}
