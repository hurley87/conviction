import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

const OWNER_READ_WRITE = 0o600;

export const agentProfileSchema = z.object({
  version: z.literal(1),
  profileName: z.string().min(1),
  agentId: z.string().uuid(),
  handle: z.string().min(1),
  operatorHandle: z.string().min(1),
  signerAddress: z.string().min(1),
  /** EIP-7702 UA owner address; equals the local signer in v1. */
  universalAccountAddress: z.string().min(1),
  keystorePath: z.string().min(1),
  fundingReady: z.boolean(),
  actionPolicy: z.object({
    trade: z.boolean(),
    back: z.boolean(),
    publish: z.boolean(),
  }),
  maxTradeUsd: z.number(),
  spendBudgetUsd: z.number(),
  createdAt: z.string(),
});

export type AgentProfile = z.infer<typeof agentProfileSchema>;

export const incompleteInitSchema = z.object({
  version: z.literal(1),
  codeHash: z.string().length(64),
  profileName: z.string().min(1),
  keystorePath: z.string().min(1),
  signerAddress: z.string().min(1),
  apiBaseUrl: z.string().url(),
  redeemed: z.boolean(),
  agentId: z.string().uuid().optional(),
  backupVerified: z.boolean(),
  createdAt: z.string(),
});

export type IncompleteInit = z.infer<typeof incompleteInitSchema>;

export async function writeAgentProfile(
  filePath: string,
  profile: AgentProfile,
): Promise<void> {
  agentProfileSchema.parse(profile);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, {
    encoding: "utf8",
    mode: OWNER_READ_WRITE,
  });
  await chmod(filePath, OWNER_READ_WRITE);
}

export async function readAgentProfile(filePath: string): Promise<AgentProfile> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  return agentProfileSchema.parse(raw);
}

export async function writeIncompleteInit(
  filePath: string,
  state: IncompleteInit,
): Promise<void> {
  incompleteInitSchema.parse(state);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: OWNER_READ_WRITE,
  });
  await chmod(filePath, OWNER_READ_WRITE);
}

export async function readIncompleteInit(
  filePath: string,
): Promise<IncompleteInit | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return incompleteInitSchema.parse(raw);
  } catch {
    return null;
  }
}
