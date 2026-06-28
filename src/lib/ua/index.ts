// UA client factory. Returns the real Particle client when the publishable
// Particle env is configured and an owner address is known; otherwise a
// deterministic mock so the app runs locally with zero credentials (ADR 0014).

import type { UAClient } from "@/lib/ua/types";
import { MockUAClient } from "@/lib/ua/mock";
import { createParticleUAClient } from "@/lib/ua/particle";

export type { UAClient } from "@/lib/ua/types";

/** Publishable Particle keys (safe in the client bundle). */
export function particleEnv() {
  return {
    projectId: process.env.NEXT_PUBLIC_PARTICLE_PROJECT_ID,
    projectClientKey: process.env.NEXT_PUBLIC_PARTICLE_CLIENT_KEY,
    projectAppUuid: process.env.NEXT_PUBLIC_PARTICLE_APP_ID,
  };
}

export function hasParticleEnv(): boolean {
  const e = particleEnv();
  return Boolean(e.projectId && e.projectClientKey && e.projectAppUuid);
}

/** Build a UA client for the given owner EOA, or a mock if unconfigured. */
export function getUAClient(ownerAddress?: string): UAClient {
  const e = particleEnv();
  if (ownerAddress && e.projectId && e.projectClientKey && e.projectAppUuid) {
    return createParticleUAClient({
      ownerAddress,
      projectId: e.projectId,
      projectClientKey: e.projectClientKey,
      projectAppUuid: e.projectAppUuid,
    });
  }
  return new MockUAClient();
}
