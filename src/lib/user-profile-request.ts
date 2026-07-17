import { z } from "zod";

export const initializeUserBodySchema = z.object({
  address: z.string().min(3).max(200),
});

export const patchUserBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveHandle"),
    handle: z.string().min(1),
  }),
  z.object({
    action: z.literal("completeOnboarding"),
  }),
]);

export type InitializeUserBody = z.infer<typeof initializeUserBodySchema>;
export type PatchUserBody = z.infer<typeof patchUserBodySchema>;
