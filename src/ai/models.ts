import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  createProviderRegistry,
  type wrapEmbeddingModel,
  type wrapLanguageModel,
} from "ai";
import { createOllama } from "ai-sdk-ollama";
import { voyage } from "voyage-ai-provider";
import type { Env } from "@/env";

// Model instances (not gateway id strings), so they can be wrapped with middleware.
type LanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];
type EmbeddingModel = Parameters<typeof wrapEmbeddingModel>[0]["model"];

/** The three model tiers every AI-backed domain operation draws from. */
export interface Models {
  /** Fast tier: intake analysis, statement updates, update drafts. */
  intake: LanguageModel;
  /** Reasoning tier: scoring and the decision brief agent. */
  reasoning: LanguageModel;
  embedding: EmbeddingModel;
}

/**
 * Whether the provider enforces a response schema while decoding (Ollama): a call that
 * carries one can only answer in that shape, so it can never call a tool.
 */
export function schemaBlocksTools(model: LanguageModel) {
  return typeof model !== "string" && model.provider === "ollama";
}

/** `provider:model` name of an embedding model, as stored with each vector. */
export function embeddingModelName(model: EmbeddingModel) {
  return typeof model === "string"
    ? model
    : `${model.provider}:${model.modelId}`;
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
