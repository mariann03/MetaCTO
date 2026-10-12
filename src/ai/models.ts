import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  createProviderRegistry,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { createOllama } from "ai-sdk-ollama";
import { voyage } from "voyage-ai-provider";
import type { Env } from "@/env";

/** The three model tiers every AI-backed domain operation draws from. */
export interface Models {
  /** Fast tier: intake analysis, statement updates, update drafts. */
  intake: LanguageModel;
  /** Reasoning tier: scoring and the decision brief agent. */
  reasoning: LanguageModel;
  embedding: EmbeddingModel;
}

export function createModels(
  config: Pick<
    Env,
    "INTAKE_MODEL" | "REASONING_MODEL" | "EMBEDDING_MODEL" | "OLLAMA_BASE_URL"
  >,
): Models {
  const registry = createProviderRegistry({
    ollama: createOllama({ baseURL: config.OLLAMA_BASE_URL }),
    anthropic,
    openai,
    voyage,
  });
  return {
    intake: registry.languageModel(config.INTAKE_MODEL),
    reasoning: registry.languageModel(config.REASONING_MODEL),
    embedding: registry.embeddingModel(config.EMBEDDING_MODEL),
  };
}
