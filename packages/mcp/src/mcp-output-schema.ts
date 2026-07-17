/**
 * MCP SDK outputSchema adapter for live read tools.
 *
 * The SDK's `normalizeObjectSchema` drops top-level unions, and `tools/list`
 * requires root `type: "object"`. This module is the only place that reaches
 * into Zod's `_zod.toJSONSchema` override so hosts that call `listTools()`
 * accept intentional `{ ok: false, code, message }` payloads while server-side
 * Zod validation stays success-strict (error results skip output validation).
 */
import { z } from "zod";

import {
  accountStatusResultSchema,
  convictionGetResultSchema,
  convictionListResultSchema,
  feedSummaryResultSchema,
  receiptGetResultSchema,
  structuredErrorResultSchema,
} from "./agent-reads-contract.js";

type JsonSchemaObject = Record<string, unknown>;

function omitJsonSchemaId(schema: JsonSchemaObject): JsonSchemaObject {
  const rest = { ...schema };
  delete rest.$schema;
  return rest;
}

const structuredErrorJsonSchema = omitJsonSchemaId(
  z.toJSONSchema(structuredErrorResultSchema, {
    target: "draft-7",
  }) as JsonSchemaObject,
);

export function mcpReadToolOutputSchema<T extends z.ZodRawShape>(
  successSchema: z.ZodObject<T>,
): z.ZodObject<T> {
  const schema = z.object(successSchema.shape);
  const successJsonSchema = omitJsonSchemaId(
    z.toJSONSchema(successSchema, { target: "draft-7" }) as JsonSchemaObject,
  );
  schema._zod.toJSONSchema = () => ({
    type: "object",
    oneOf: [successJsonSchema, structuredErrorJsonSchema],
  });
  return schema;
}

export const accountStatusOutputSchema = mcpReadToolOutputSchema(
  accountStatusResultSchema,
);
export const listConvictionsOutputSchema = mcpReadToolOutputSchema(
  convictionListResultSchema,
);
export const getConvictionOutputSchema = mcpReadToolOutputSchema(
  convictionGetResultSchema,
);
export const summarizeFeedOutputSchema = mcpReadToolOutputSchema(
  feedSummaryResultSchema,
);
export const getReceiptOutputSchema = mcpReadToolOutputSchema(
  receiptGetResultSchema,
);
