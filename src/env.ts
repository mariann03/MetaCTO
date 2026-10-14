import { z } from "zod";

// `provider:model`, typed as a template literal so it feeds the registry without casts.
// Providers are limited per tier so a wrong pairing fails here, not deep in the registry.
const languageModelId = z.templateLiteral([
  z.enum(["ollama", "anthropic", "openai"]),
  ":",
  z.string().min(1),
]);
const embeddingModelId = z.templateLiteral([
  z.enum(["ollama", "openai", "voyage"]),
  ":",
  z.string().min(1),
]);

const envSchema = z
  .object({
    DATABASE_URL: z.url(),
    // Local Ollama models by default; hosted providers are one env change away.
    INTAKE_MODEL: languageModelId.default("ollama:gemma4:12b"),
    REASONING_MODEL: languageModelId.default("ollama:qwen3.6:27b"),
    EMBEDDING_MODEL: embeddingModelId.default("ollama:bge-m3"),
    OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
    /** Playwright only: swap every model for the deterministic fake. */
    E2E_FAKE_AI: z.literal("1").optional(),
    // Langfuse tracing: all three, or none to leave tracing off.
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_BASE_URL: z.url().optional(),
  })
  .refine(
    (env) =>
      [0, 3].includes(
        [
          env.LANGFUSE_PUBLIC_KEY,
          env.LANGFUSE_SECRET_KEY,
          env.LANGFUSE_BASE_URL,
        ].filter(Boolean).length,
      ),
    "Set LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL together, or none of them",
  );

/** Validated runtime configuration; model ids are typed `provider:model` strings. */
export type Env = z.infer<typeof envSchema>;

/** Tracing is on only when Langfuse is fully configured; otherwise nothing is registered. */
export const tracingEnabled = (env: Env) =>
  env.LANGFUSE_PUBLIC_KEY !== undefined;

/** Parse once at each composition root so misconfiguration fails fast and loud. */
export function readEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(source);
}
