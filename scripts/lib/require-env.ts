/** Shared by desk CLI scripts — keeps them as modules under root tsconfig. */

export function requireEnv(name: string, why: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. ${why}`);
    process.exit(1);
  }
  return value;
}
