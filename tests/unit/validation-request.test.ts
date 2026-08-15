import { describe, expect, it } from "vitest";

import { Priority, RequestStatus } from "@/generated/prisma/enums";
import { commentSchema, deleteCommentSchema } from "@/lib/validation/comment";
import {
  changeRequestStatusSchema,
  createRequestSchema,
  requestListQuerySchema,
  updateRequestSchema,
} from "@/lib/validation/request";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

const valid = {
  clientId: CLIENT_ID,
  title: "March bank statements",
  description: "",
  priority: Priority.HIGH,
  assignedToId: MEMBER_ID,
  requestedDate: "2026-08-01",
  requiredBy: "2026-08-10",
  notes: "",
};

describe("createRequestSchema", () => {
  it("accepts a well-formed request", () => {
    expect(createRequestSchema.safeParse(valid).success).toBe(true);
  });

  it("requires the two legacy-mandatory fields", () => {
    // Legacy createClientRequest: Client ID and Request.
    expect(
      createRequestSchema.safeParse({ ...valid, clientId: "" }).success,
    ).toBe(false);
    expect(createRequestSchema.safeParse({ ...valid, title: " " }).success).toBe(
      false,
    );
  });

  it("does not accept a status — creation status is a service decision", () => {
    const parsed = createRequestSchema.parse({
      ...valid,
      status: RequestStatus.RECEIVED,
    });
    expect(parsed).not.toHaveProperty("status");
  });

  it("does not accept days waiting or its bucket — both are derived", () => {
    const parsed = createRequestSchema.parse({
      ...valid,
      daysWaiting: 99,
      bucket: "15+",
    });
    expect(parsed).not.toHaveProperty("daysWaiting");
    expect(parsed).not.toHaveProperty("bucket");
  });

  it("does not accept a received date — only the status change stamps it", () => {
    const parsed = createRequestSchema.parse({
      ...valid,
      receivedDate: "2026-08-05",
    });
    expect(parsed).not.toHaveProperty("receivedDate");
  });

  it("normalises empty optional text and dates to null", () => {
    const parsed = createRequestSchema.parse({
      ...valid,
      description: "",
      notes: "",
      requiredBy: "",
      assignedToId: "",
    });
    expect(parsed.description).toBeNull();
    expect(parsed.notes).toBeNull();
    expect(parsed.requiredBy).toBeNull();
    expect(parsed.assignedToId).toBeNull();
  });

  it("rejects an unknown priority", () => {
    expect(
      createRequestSchema.safeParse({ ...valid, priority: "URGENT" }).success,
    ).toBe(false);
  });

  it("enforces the title length bounds", () => {
    expect(createRequestSchema.safeParse({ ...valid, title: "A" }).success).toBe(
      false,
    );
    expect(
      createRequestSchema.safeParse({ ...valid, title: "A".repeat(201) })
        .success,
    ).toBe(false);
  });
});

describe("updateRequestSchema", () => {
  it("requires a request id", () => {
    expect(updateRequestSchema.safeParse(valid).success).toBe(false);
    expect(
      updateRequestSchema.safeParse({ ...valid, requestId: REQUEST_ID }).success,
    ).toBe(true);
  });

  it("carries no status field — status moves through its own action", () => {
    const parsed = updateRequestSchema.parse({
      ...valid,
      requestId: REQUEST_ID,
      status: RequestStatus.RECEIVED,
    });
    expect(parsed).not.toHaveProperty("status");
  });
});

describe("changeRequestStatusSchema", () => {
  it("accepts every known status — requests have no transition table", () => {
    for (const status of Object.values(RequestStatus)) {
      expect(
        changeRequestStatusSchema.safeParse({ requestId: REQUEST_ID, status })
          .success,
        status,
      ).toBe(true);
    }
  });

  it("accepts an optional received date, as legacy updateRequestStatus did", () => {
    const parsed = changeRequestStatusSchema.parse({
      requestId: REQUEST_ID,
      status: RequestStatus.RECEIVED,
      receivedDate: "2026-08-09",
    });
    expect(parsed.receivedDate).toBeInstanceOf(Date);

    const blank = changeRequestStatusSchema.parse({
      requestId: REQUEST_ID,
      status: RequestStatus.RECEIVED,
    });
    expect(blank.receivedDate).toBeUndefined();
  });

  it("rejects an unknown status", () => {
    expect(
      changeRequestStatusSchema.safeParse({
        requestId: REQUEST_ID,
        status: "ARRIVED",
      }).success,
    ).toBe(false);
  });
});

describe("requestListQuerySchema", () => {
  it("supplies defaults for an empty query", () => {
    const parsed = requestListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.sort).toBe("waiting");
    expect(parsed.stale).toBe(false);
  });

  it("reads stale only from an explicit true token", () => {
    expect(requestListQuerySchema.parse({ stale: "true" }).stale).toBe(true);
    expect(requestListQuerySchema.parse({ stale: "1" }).stale).toBe(true);
    expect(requestListQuerySchema.parse({ stale: "false" }).stale).toBe(false);
    expect(requestListQuerySchema.parse({ stale: "" }).stale).toBe(false);
    expect(requestListQuerySchema.parse({ stale: "0" }).stale).toBe(false);
  });

  it("accepts the OPEN pseudo-status alongside real statuses", () => {
    expect(requestListQuerySchema.parse({ status: "OPEN" }).status).toBe("OPEN");
    expect(
      requestListQuerySchema.parse({ status: RequestStatus.PARTIALLY_RECEIVED })
        .status,
    ).toBe(RequestStatus.PARTIALLY_RECEIVED);
    expect(requestListQuerySchema.safeParse({ status: "WAITING" }).success).toBe(
      false,
    );
  });

  it("rejects page 0 and an unknown sort key", () => {
    expect(requestListQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(requestListQuerySchema.safeParse({ sort: "random" }).success).toBe(
      false,
    );
  });
});

describe("shared comment schemas", () => {
  it("rejects an empty or whitespace-only comment", () => {
    expect(
      commentSchema.safeParse({ parentId: REQUEST_ID, body: "" }).success,
    ).toBe(false);
    expect(
      commentSchema.safeParse({ parentId: REQUEST_ID, body: "   " }).success,
    ).toBe(false);
  });

  it("trims the body and caps its length", () => {
    expect(
      commentSchema.parse({ parentId: REQUEST_ID, body: "  Chased  " }).body,
    ).toBe("Chased");
    expect(
      commentSchema.safeParse({ parentId: REQUEST_ID, body: "x".repeat(4001) })
        .success,
    ).toBe(false);
  });

  it("requires both ids to delete a comment", () => {
    expect(
      deleteCommentSchema.safeParse({
        parentId: REQUEST_ID,
        commentId: COMMENT_ID,
      }).success,
    ).toBe(true);
    expect(
      deleteCommentSchema.safeParse({ parentId: REQUEST_ID }).success,
    ).toBe(false);
  });
});
