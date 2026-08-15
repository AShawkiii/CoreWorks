import { describe, expect, it } from "vitest";

import {
  Priority,
  ReviewStatus,
  TaskCategory,
  TaskStatus,
} from "@/generated/prisma/enums";
import {
  bulkReassignSchema,
  bulkStatusSchema,
  changeTaskStatusSchema,
  createTaskSchema,
  deleteTaskCommentSchema,
  periodSchema,
  taskCommentSchema,
  taskListQuerySchema,
  updateTaskSchema,
} from "@/lib/validation/task";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

const valid = {
  clientId: CLIENT_ID,
  taskName: "Prepare VAT return",
  serviceArea: "Tax",
  description: "",
  period: "2026-03",
  assignedToId: MEMBER_ID,
  reviewerId: "",
  priority: Priority.HIGH,
  dueDate: "2026-04-07",
  startDate: "",
  reviewStatus: ReviewStatus.NOT_REVIEWED,
  clientDependency: false,
  waitingFor: "",
  notes: "",
};

describe("createTaskSchema", () => {
  it("accepts a well-formed task", () => {
    const result = createTaskSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("defaults the category to ad-hoc", () => {
    // Recurring tasks are produced by generation, not by this form.
    const parsed = createTaskSchema.parse(valid);
    expect(parsed.taskCategory).toBe(TaskCategory.AD_HOC);
  });

  it("requires the three legacy-mandatory fields", () => {
    // Legacy validateTaskFields: Client ID, Task Name, Service Area.
    for (const [field, bad] of [
      ["clientId", ""],
      ["taskName", " "],
      ["serviceArea", ""],
    ] as const) {
      const result = createTaskSchema.safeParse({ ...valid, [field]: bad });
      expect(result.success, `${field} should be rejected`).toBe(false);
    }
  });

  it("trims the task name and service area", () => {
    const parsed = createTaskSchema.parse({
      ...valid,
      taskName: "  Prepare VAT return  ",
      serviceArea: "  Tax  ",
    });
    expect(parsed.taskName).toBe("Prepare VAT return");
    expect(parsed.serviceArea).toBe("Tax");
  });

  it("normalises empty optional text to null rather than an empty string", () => {
    const parsed = createTaskSchema.parse(valid);
    expect(parsed.description).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.waitingFor).toBeNull();
    expect(parsed.reviewerId).toBeNull();
    expect(parsed.startDate).toBeNull();
  });

  it("rejects a non-uuid member id", () => {
    const result = createTaskSchema.safeParse({
      ...valid,
      assignedToId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown priority or review status", () => {
    expect(
      createTaskSchema.safeParse({ ...valid, priority: "URGENT" }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...valid, reviewStatus: "MAYBE" }).success,
    ).toBe(false);
  });

  it("enforces the task name length bounds", () => {
    expect(
      createTaskSchema.safeParse({ ...valid, taskName: "A" }).success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...valid, taskName: "A".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      createTaskSchema.safeParse({ ...valid, taskName: "A".repeat(200) })
        .success,
    ).toBe(true);
  });

  it("does not accept a status — creation status is a domain decision", () => {
    const parsed = createTaskSchema.parse({
      ...valid,
      status: TaskStatus.COMPLETED,
    });
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("periodSchema", () => {
  it("accepts every valid month", () => {
    for (let month = 1; month <= 12; month += 1) {
      const value = `2026-${String(month).padStart(2, "0")}`;
      expect(periodSchema.safeParse(value).success, value).toBe(true);
    }
  });

  it("rejects month 00 and month 13", () => {
    expect(periodSchema.safeParse("2026-00").success).toBe(false);
    expect(periodSchema.safeParse("2026-13").success).toBe(false);
  });

  it("rejects an unpadded month, a full date, and a free-text period", () => {
    expect(periodSchema.safeParse("2026-3").success).toBe(false);
    expect(periodSchema.safeParse("2026-03-01").success).toBe(false);
    expect(periodSchema.safeParse("March 2026").success).toBe(false);
  });

  it("maps an empty period to null", () => {
    expect(periodSchema.parse("")).toBeNull();
  });
});

describe("updateTaskSchema", () => {
  it("requires a task id", () => {
    expect(updateTaskSchema.safeParse(valid).success).toBe(false);
    expect(
      updateTaskSchema.safeParse({ ...valid, taskId: TASK_ID }).success,
    ).toBe(true);
  });

  it("carries no status field — status moves through its own action", () => {
    const parsed = updateTaskSchema.parse({
      ...valid,
      taskId: TASK_ID,
      status: TaskStatus.CANCELLED,
    });
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("changeTaskStatusSchema", () => {
  it("accepts each known status", () => {
    for (const status of Object.values(TaskStatus)) {
      expect(
        changeTaskStatusSchema.safeParse({ taskId: TASK_ID, status }).success,
        status,
      ).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    expect(
      changeTaskStatusSchema.safeParse({ taskId: TASK_ID, status: "DONE" })
        .success,
    ).toBe(false);
  });
});

describe("comment schemas", () => {
  it("rejects an empty or whitespace-only comment", () => {
    expect(
      taskCommentSchema.safeParse({ taskId: TASK_ID, body: "" }).success,
    ).toBe(false);
    expect(
      taskCommentSchema.safeParse({ taskId: TASK_ID, body: "   " }).success,
    ).toBe(false);
  });

  it("trims the comment body", () => {
    const parsed = taskCommentSchema.parse({
      taskId: TASK_ID,
      body: "  Chased the client  ",
    });
    expect(parsed.body).toBe("Chased the client");
  });

  it("caps the comment length", () => {
    expect(
      taskCommentSchema.safeParse({ taskId: TASK_ID, body: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });

  it("requires both ids to delete a comment", () => {
    expect(
      deleteTaskCommentSchema.safeParse({
        taskId: TASK_ID,
        commentId: COMMENT_ID,
      }).success,
    ).toBe(true);
    expect(
      deleteTaskCommentSchema.safeParse({ taskId: TASK_ID }).success,
    ).toBe(false);
  });
});

describe("bulk schemas", () => {
  it("requires at least one task", () => {
    expect(
      bulkStatusSchema.safeParse({
        taskIds: [],
        status: TaskStatus.IN_PROGRESS,
      }).success,
    ).toBe(false);
  });

  it("caps a batch at 200", () => {
    const ids = Array.from({ length: 201 }, () => TASK_ID);
    expect(
      bulkStatusSchema.safeParse({ taskIds: ids, status: TaskStatus.BLOCKED })
        .success,
    ).toBe(false);
    expect(
      bulkStatusSchema.safeParse({
        taskIds: ids.slice(0, 200),
        status: TaskStatus.BLOCKED,
      }).success,
    ).toBe(true);
  });

  it("treats an empty bulk assignee as unassign", () => {
    const parsed = bulkReassignSchema.parse({
      taskIds: [TASK_ID],
      assignedToId: "",
    });
    expect(parsed.assignedToId).toBeNull();
  });

  it("rejects a non-uuid task id in the batch", () => {
    expect(
      bulkStatusSchema.safeParse({
        taskIds: [TASK_ID, "nope"],
        status: TaskStatus.BLOCKED,
      }).success,
    ).toBe(false);
  });
});

describe("taskListQuerySchema", () => {
  it("supplies defaults for an empty query", () => {
    const parsed = taskListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.sort).toBe("dueDate");
    expect(parsed.overdue).toBe(false);
  });

  it("reads overdue only from an explicit true token", () => {
    // z.coerce.boolean() would read "false" as true; this must not.
    expect(taskListQuerySchema.parse({ overdue: "true" }).overdue).toBe(true);
    expect(taskListQuerySchema.parse({ overdue: "1" }).overdue).toBe(true);
    expect(taskListQuerySchema.parse({ overdue: "false" }).overdue).toBe(false);
    expect(taskListQuerySchema.parse({ overdue: "" }).overdue).toBe(false);
    expect(taskListQuerySchema.parse({ overdue: "0" }).overdue).toBe(false);
  });

  it("accepts the OPEN pseudo-status alongside real statuses", () => {
    expect(taskListQuerySchema.parse({ status: "OPEN" }).status).toBe("OPEN");
    expect(taskListQuerySchema.parse({ status: "ALL" }).status).toBe("ALL");
    expect(
      taskListQuerySchema.parse({ status: TaskStatus.BLOCKED }).status,
    ).toBe(TaskStatus.BLOCKED);
    expect(taskListQuerySchema.safeParse({ status: "OPENISH" }).success).toBe(
      false,
    );
  });

  it("accepts UNASSIGNED as an assignee filter", () => {
    expect(
      taskListQuerySchema.parse({ assignedToId: "UNASSIGNED" }).assignedToId,
    ).toBe("UNASSIGNED");
    expect(
      taskListQuerySchema.safeParse({ assignedToId: "someone" }).success,
    ).toBe(false);
  });

  it("coerces the page number and rejects page 0", () => {
    expect(taskListQuerySchema.parse({ page: "3" }).page).toBe(3);
    expect(taskListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
  });

  it("rejects an unknown sort key", () => {
    expect(taskListQuerySchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
  });
});
