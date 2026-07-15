import { describe, it, expect, beforeEach } from "vitest";
import {
  hasSeenUpgradeBeat,
  markUpgradeBeatSeen,
  shouldRevealUpgradeBeat,
  upgradeBeatStorageKey,
} from "@/lib/upgrade-beat";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    key() {
      return null;
    },
  };
}

describe("upgrade beat persistence", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("keys beat state by lowercased address", () => {
    expect(upgradeBeatStorageKey("0xAbC")).toBe(
      "conviction:upgrade-beat-seen:0xabc",
    );
  });

  it("reveals once, then never again after dismiss", () => {
    const address = "0x1234abcd5678ef901234abcd5678ef901234abcd";
    expect(shouldRevealUpgradeBeat(address, storage)).toBe(true);
    expect(hasSeenUpgradeBeat(address, storage)).toBe(false);

    markUpgradeBeatSeen(address, storage);

    expect(hasSeenUpgradeBeat(address, storage)).toBe(true);
    expect(shouldRevealUpgradeBeat(address, storage)).toBe(false);
    // Same address, different casing
    expect(shouldRevealUpgradeBeat(address.toUpperCase(), storage)).toBe(false);
  });

  it("does not reveal without an address", () => {
    expect(shouldRevealUpgradeBeat(null, storage)).toBe(false);
    expect(shouldRevealUpgradeBeat(undefined, storage)).toBe(false);
  });
});
