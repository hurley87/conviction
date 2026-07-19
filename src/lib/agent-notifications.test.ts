import { beforeEach, describe, expect, it } from "vitest";

import {
  getAgentNotificationStore,
  resetAgentNotificationStoreForTests,
} from "@/lib/agent-notifications";

const base = {
  agentId: "agent-1",
  ownerUserId: "user-1",
  kind: "trade_success" as const,
  severity: "info" as const,
  title: "Trade executed",
  body: "Trade settled.",
  dedupeKey: "receipt-1",
};

describe("agent notification store", () => {
  beforeEach(() => {
    resetAgentNotificationStoreForTests();
  });

  it("creates idempotently by agent, kind, and dedupe key", async () => {
    const store = getAgentNotificationStore();
    const first = await store.createIdempotent(base);
    const second = await store.createIdempotent({ ...base, title: "Ignored" });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.notification.notificationId).toBe(first.notification.notificationId);
    expect(await store.listByAgent(base.agentId)).toHaveLength(1);
  });

  it("lists notifications for the owner", async () => {
    const store = getAgentNotificationStore();
    await store.createIdempotent(base);
    await store.createIdempotent({
      ...base,
      agentId: "agent-2",
      ownerUserId: "user-2",
      dedupeKey: "receipt-2",
    });

    const notifications = await store.listByOwner("user-1");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.agentId).toBe("agent-1");
  });

  it("marks only an owned notification as read", async () => {
    const store = getAgentNotificationStore();
    const { notification } = await store.createIdempotent(base);

    expect(await store.markRead(notification.notificationId, "other-user")).toBeNull();
    const read = await store.markRead(notification.notificationId, base.ownerUserId);
    expect(read?.readAt).toBeTruthy();
  });
});
