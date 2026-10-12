import { z } from "zod";

// `provider:model`, typed as a template literal so it feeds the registry without casts.
// Providers are limited per tier so a wrong pairing fails here, not deep in the registry.
const modelId = <const P extends readonly [string, ...string[]]>(
  providers: P,
) => z.templateLiteral([z.enum(providers), ":", z.string().min(1)]);
const languageModelId = modelId(["ollama", "anthropic", "openai"]);
const embeddingModelId = modelId(["ollama", "openai", "voyage"]);

const envSchema = z.object({
  DATABASE_URL: z.url(),
  // Local Ollama models by default; hosted providers are one env change away.
  INTAKE_MODEL: languageModelId.default("ollama:gemma4:12b"),
  REASONING_MODEL: languageModelId.default("ollama:qwen3.6:27b"),
  EMBEDDING_MODEL: embeddingModelId.default("ollama:bge-m3"),
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  /** Playwright only: swap every model for the deterministic fake. */
  E2E_FAKE_AI: z.literal("1").optional(),
});

/** Validated runtime configuration; model ids are typed `provider:model` strings. */
export type Env = z.infer<typeof envSchema>;

/** Parse once at each composition root so misconfiguration fails fast and loud. */
export function readEnv(
  source: Record<string, string | undefined> = process.env,
): Env {
  return envSchema.parse(source);
}
