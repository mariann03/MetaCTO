import { z } from "zod";

const modelId = z
  .string()
  .regex(/^(anthropic|openai|voyage):.+$/, "expected provider:model");

const envSchema = z.object({
  DATABASE_URL: z.url(),
  INTAKE_MODEL: modelId.default("anthropic:claude-haiku-5-5"),
  REASONING_MODEL: modelId.default("anthropic:claude-sonnet-5-5"),
  EMBEDDING_MODEL: modelId.default("voyage:voyage-4"),
  /** Playwright only: swap every model for the deterministic fake. */
  E2E_FAKE_AI: z.literal("1").optional(),
});

export type Env = z.infer<typeof envSchema>;

/** Parse once at each composition root so misconfiguration fails fast and loud. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
