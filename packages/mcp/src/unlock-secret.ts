import { randomBytes } from "node:crypto";

export const KEYSTORE_PASSWORD_ENV = "CONVICTION_KEYSTORE_PASSWORD";
export const PRIVATE_KEY_ENV = "CONVICTION_PRIVATE_KEY";

export class UnlockSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnlockSecretError";
  }
}

export type UnlockSecretStore = {
  get(account: string): string | null;
  set(account: string, secret: string): void;
};

/** In-memory store used by tests and headless env-backed unlock. */
export class MemoryUnlockSecretStore implements UnlockSecretStore {
  private readonly secrets = new Map<string, string>();

  get(account: string): string | null {
    return this.secrets.get(account) ?? null;
  }

  set(account: string, secret: string): void {
    this.secrets.set(account, secret);
  }
}

type KeyringEntry = {
  getPassword(): string | null;
  setPassword(password: string): void;
};

type KeyringModule = {
  Entry: new (service: string, account: string) => KeyringEntry;
};

/**
 * Resolve the machine unlock secret for a profile.
 * Never accepts a raw private key environment variable.
 */
export function resolveOrCreateUnlockSecret(options: {
  profileName: string;
  store: UnlockSecretStore;
  env?: NodeJS.ProcessEnv;
  generate?: () => string;
}): { secret: string; source: "keyring" | "env" | "generated" } {
  const env = options.env ?? process.env;
  if (env[PRIVATE_KEY_ENV]?.trim()) {
    throw new UnlockSecretError(
      `${PRIVATE_KEY_ENV} is not supported. Use an encrypted keystore unlock secret via the OS credential store or ${KEYSTORE_PASSWORD_ENV}.`,
    );
  }

  const existing = options.store.get(options.profileName);
  if (existing) {
    return { secret: existing, source: "keyring" };
  }

  const fromEnv = env[KEYSTORE_PASSWORD_ENV]?.trim();
  if (fromEnv) {
    options.store.set(options.profileName, fromEnv);
    return { secret: fromEnv, source: "env" };
  }

  const generated =
    options.generate?.() ?? randomBytes(32).toString("base64url");
  options.store.set(options.profileName, generated);
  return { secret: generated, source: "generated" };
}

async function tryImportKeyring(): Promise<KeyringModule | null> {
  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (specifier: string) => Promise<KeyringModule>;
    return await dynamicImport("@napi-rs/keyring");
  } catch {
    return null;
  }
}

/**
 * Prefer @napi-rs/keyring when available; otherwise require the headless env var.
 */
export async function createDefaultUnlockSecretStore(
  env: NodeJS.ProcessEnv = process.env,
): Promise<UnlockSecretStore> {
  const keyring = await tryImportKeyring();
  if (keyring) {
    return {
      get(account: string) {
        try {
          return new keyring.Entry("conviction-mcp", account).getPassword();
        } catch {
          return null;
        }
      },
      set(account: string, secret: string) {
        new keyring.Entry("conviction-mcp", account).setPassword(secret);
      },
    };
  }

  if (!env[KEYSTORE_PASSWORD_ENV]?.trim()) {
    throw new UnlockSecretError(
      `No OS credential store is available. Set ${KEYSTORE_PASSWORD_ENV} for headless unlock, or install @napi-rs/keyring support.`,
    );
  }
  return new MemoryUnlockSecretStore();
}
