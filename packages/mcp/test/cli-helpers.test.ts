import { describe, expect, it } from "vitest";

import {
  DEFAULT_BACKUP_PATH,
  expandHomePath,
  resolveApiBaseUrl,
  resolveDefaultBackupPath,
} from "../src/cli-helpers.js";

describe("cli-helpers", () => {
  it("defaults backup path and expands ~", () => {
    expect(resolveDefaultBackupPath(undefined)).toBe(
      expandHomePath(DEFAULT_BACKUP_PATH),
    );
    expect(resolveDefaultBackupPath("~/custom-backup.json")).toBe(
      expandHomePath("~/custom-backup.json"),
    );
    expect(resolveDefaultBackupPath("/tmp/backup.json")).toBe(
      "/tmp/backup.json",
    );
  });

  it("resolves api base flag → env → profile → localhost", () => {
    expect(
      resolveApiBaseUrl({
        flagValue: "https://flag.example/",
        env: { CONVICTION_API_BASE: "https://env.example" },
        profileApiBaseUrl: "https://profile.example",
      }),
    ).toBe("https://flag.example");

    expect(
      resolveApiBaseUrl({
        env: { CONVICTION_API_BASE: "https://env.example/" },
        profileApiBaseUrl: "https://profile.example",
      }),
    ).toBe("https://env.example");

    expect(
      resolveApiBaseUrl({
        env: {},
        profileApiBaseUrl: "https://profile.example/",
      }),
    ).toBe("https://profile.example");

    expect(resolveApiBaseUrl({ env: {} })).toBe("http://127.0.0.1:3000");
  });
});
