import { describe, expect, it, vi } from "vitest";
import { FifoSaveQueue, type ChatSaveStatus } from "@/lib/chat-save-queue";

describe("FifoSaveQueue", () => {
  it("saves optimistic messages in FIFO order", async () => {
    const saved: number[] = [];
    const statuses: ChatSaveStatus[] = [];
    const queue = new FifoSaveQueue<number>(
      async (value) => {
        saved.push(value);
      },
      (status) => statuses.push(status),
    );
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await queue.retry();
    expect(saved).toEqual([1, 2, 3]);
    expect(queue.pending()).toEqual([]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("stops on failure and retries the same item before later messages", async () => {
    const attempts: string[] = [];
    const statuses: ChatSaveStatus[] = [];
    let fail = true;
    const queue = new FifoSaveQueue<string>(
      async (value) => {
        attempts.push(value);
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
      },
      (status) => statuses.push(status),
    );
    queue.enqueue("first");
    queue.enqueue("second");
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("error"));
    expect(queue.pending()).toEqual(["first", "second"]);
    await queue.retry();
    expect(attempts).toEqual(["first", "first", "second"]);
    expect(queue.pending()).toEqual([]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("drops stale in-flight work when reset for a clear", async () => {
    let resolveSave: (() => void) | undefined;
    const save = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    const queue = new FifoSaveQueue<string>(() => save, () => {});
    queue.enqueue("old conversation");
    queue.reset();
    resolveSave?.();
    await save;
    expect(queue.pending()).toEqual([]);
  });
});
