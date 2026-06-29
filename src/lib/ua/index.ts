// UA client factory. Returns the real Particle client when the publishable
// Particle env is configured and an owner address is known; otherwise a
// deterministic mock so the app runs locally with zero credentials (ADR 0014).

import type { UAClient } from "@/lib/ua/types";
import { MockUAClient } from "@/lib/ua/mock";
import { createParticleUAClient } from "@/lib/ua/particle";

export type { UAClient } from "@/lib/ua/types";

type ParticleEnv = {
  projectId: string;
  projectClientKey: string;
  projectAppUuid: string;
};

/** Publishable Particle keys, or null unless all three are present. */
function particleEnv(): ParticleEnv | null {
  const projectId = process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID;
  const projectClientKey = process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY;
  const projectAppUuid = process.env.NEXT_PUBLIC_PARTICLE_APP_ID;
  if (!projectId || !projectClientKey || !projectAppUuid) return null;
  return { projectId, projectClientKey, projectAppUuid };
}

export function hasParticleEnv(): boolean {
  return particleEnv() !== null;
}

/** Build a UA client for the given owner EOA, or a mock if unconfigured. */
export function getUAClient(ownerAddress?: string): UAClient {
  const env = particleEnv();
  if (ownerAddress && env) {
    return createParticleUAClient({ ownerAddress, ...env });
  }
  return new MockUAClient();
}
