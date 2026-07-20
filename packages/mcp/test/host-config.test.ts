import { describe, expect, it } from "vitest";

import { generateHostConfigs, formatHostConfigGuide } from "../src/host-config.js";
import {
  PACKAGE_MAJOR_PIN,
  SETUP_CONTRACT,
  SUPPORTED_HOST_IDS,
} from "../src/setup-contract.js";

describe("generateHostConfigs", () => {
  it("pins the v1 major for every supported host and never embeds secrets", () => {
    const snippets = generateHostConfigs({ profileName: "signal-scout" });
    expect(snippets.map((snippet) => snippet.hostId)).toEqual([
      ...SUPPORTED_HOST_IDS,
    ]);

    const blob = JSON.stringify(snippets);
    expect(blob).toContain(PACKAGE_MAJOR_PIN);
    expect(blob).not.toMatch(/latest(?![\w-])/);
    expect(blob).not.toContain("--code");
    expect(blob).not.toContain("CONVICTION_KEYSTORE_PASSWORD");
    expect(blob).not.toContain("CONVICTION_BACKUP_PASSPHRASE");
    expect(blob).not.toContain("CONVICTION_PRIVATE_KEY");
    expect(blob).not.toMatch(/0x[a-fA-F0-9]{64}/);

    for (const host of SETUP_CONTRACT.hosts) {
      expect(snippets.some((snippet) => snippet.hostId === host.id)).toBe(true);
    }
  });

  it("keeps one shared serve contract across hosts", () => {
    const guide = formatHostConfigGuide({ profileName: "signal-scout" });
    expect(guide).toContain("Shared MCP contract");
    expect(guide).toContain("npx -y @getconviction/mcp@2 serve --profile signal-scout");
    expect(guide).toContain("Claude Code");
    expect(guide).toContain("Codex");
    expect(guide).toContain("Hermes");
    expect(guide).toContain("OpenClaw");
    expect(guide).toContain("Windows is supported through WSL");
    expect(guide).toContain("Native Windows is deferred");
  });
});
