import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  createProviderRegistry,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
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
  ids: Pick<Env, "INTAKE_MODEL" | "REASONING_MODEL" | "EMBEDDING_MODEL">,
): Models {
  const registry = createProviderRegistry({ anthropic, openai, voyage });
  return {
    intake: registry.languageModel(ids.INTAKE_MODEL),
    reasoning: registry.languageModel(ids.REASONING_MODEL),
    embedding: registry.embeddingModel(ids.EMBEDDING_MODEL),
  };
}
