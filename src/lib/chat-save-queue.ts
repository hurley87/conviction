export type ChatSaveStatus = "saving" | "saved" | "error";

export class FifoSaveQueue<T> {
  private items: T[] = [];
  private running: Promise<void> | null = null;
  private epoch = 0;

  constructor(
    private readonly save: (item: T) => Promise<void>,
    private readonly onStatus: (status: ChatSaveStatus) => void,
  ) {}

  enqueue(item: T) {
    this.items.push(item);
    void this.drain();
  }

  enqueueMany(items: T[]) {
    this.items.push(...items);
    if (items.length > 0) void this.drain();
  }

  pending() {
    return [...this.items];
  }

  reset() {
    this.epoch += 1;
    this.items = [];
    this.onStatus("saved");
  }

  retry() {
    return this.drain();
  }

  private drain(): Promise<void> {
    if (this.running) return this.running;
    const epoch = this.epoch;
    this.running = (async () => {
      if (this.items.length === 0) {
        this.onStatus("saved");
        return;
      }
      this.onStatus("saving");
      while (this.items.length > 0 && this.epoch === epoch) {
        const item = this.items[0];
        try {
          await this.save(item);
        } catch {
          if (this.epoch === epoch) this.onStatus("error");
          return;
        }
        if (this.epoch === epoch && this.items[0] === item) {
          this.items.shift();
        }
      }
      if (this.epoch === epoch && this.items.length === 0) {
        this.onStatus("saved");
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
