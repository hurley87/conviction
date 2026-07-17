import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { generateHostConfigs } from "../src/host-config.js";
import {
  PACKAGE_MAJOR_PIN,
  SETUP_CONTRACT,
  SETUP_CONTRACT_VERSION,
  assertSetupContract,
  resolveSetupPhase,
} from "../src/setup-contract.js";

const skillPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../skills/conviction-mcp-setup/SKILL.md",
);

describe("setup contract and public skill", () => {
  it("validates the frozen setup contract shape", () => {
    const parsed = assertSetupContract(SETUP_CONTRACT);
    expect(parsed.version).toBe(SETUP_CONTRACT_VERSION);
    expect(parsed.packageMajorPin).toBe(PACKAGE_MAJOR_PIN);
    expect(parsed.steps.map((step) => step.id)).toEqual([
      "create",
      "provision",
      "backup",
      "verify",
      "fund",
    ]);
    expect(parsed.platforms.find((platform) => platform.id === "windows-native")?.support).toBe(
      "deferred",
    );
  });

  it("maps observable state to one phase, including terminal agents", () => {
    expect(resolveSetupPhase(null)).toMatchObject({
      kind: "create",
      currentStep: "create",
      suggestFunding: false,
    });
    expect(
      resolveSetupPhase({
        status: "active",
        fundingReady: true,
        setupVerifiedAt: null,
      }),
    ).toMatchObject({
      kind: "verify",
      currentStep: "verify",
      suggestFunding: false,
    });
    expect(
      resolveSetupPhase({
        status: "active",
        fundingReady: true,
        setupVerifiedAt: "2026-07-17T12:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "fund",
      currentStep: "fund",
      suggestFunding: true,
    });
    expect(
      resolveSetupPhase({
        status: "disabled",
        fundingReady: true,
        setupVerifiedAt: "2026-07-17T12:00:00.000Z",
      }),
    ).toMatchObject({
      kind: "terminal",
      currentStep: null,
      suggestFunding: false,
    });
  });

  it("keeps the Agent Skills guide aligned with the same contract and host snippets", async () => {
    const skill = await readFile(skillPath, "utf8");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toContain("name: conviction-mcp-setup");
    expect(skill).toContain(`setupContractVersion: "${SETUP_CONTRACT_VERSION}"`);
    expect(skill).toContain(PACKAGE_MAJOR_PIN);
    expect(skill).toContain(SETUP_CONTRACT.sharedMcpContractNote);

    for (const host of SETUP_CONTRACT.hosts) {
      expect(skill).toContain(host.label);
    }
    expect(skill).toContain("macOS");
    expect(skill).toContain("Linux");
    expect(skill).toMatch(/Windows through WSL/i);
    expect(skill).toMatch(/Native Windows/i);
    expect(skill).toMatch(/deferred/i);

    for (const rule of SETUP_CONTRACT.skillBoundaries.mustNot) {
      expect(skill.toLowerCase()).toContain(rule.toLowerCase().slice(0, 24));
    }

    const snippets = generateHostConfigs({ profileName: "<name>" });
    for (const snippet of snippets) {
      expect(skill).toContain(snippet.primary);
    }
    expect(skill).toContain("conviction-mcp doctor --profile <name>");
    expect(skill).not.toContain("--code <");
    expect(skill).not.toMatch(/CONVICTION_PRIVATE_KEY|0x[a-fA-F0-9]{64}/);
  });
});
