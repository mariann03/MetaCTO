import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import {
  createProviderRegistry,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { voyage } from "voyage-ai-provider";

export type Models = {
  /** Fast tier: intake analysis, statement updates, update drafts. */
  intake: LanguageModel;
  /** Reasoning tier: scoring and the decision brief agent. */
  reasoning: LanguageModel;
  embedding: EmbeddingModel;
};

type ModelId = `${"anthropic" | "openai" | "voyage"}:${string}`;

export function createModels(ids: {
  INTAKE_MODEL: string;
  REASONING_MODEL: string;
  EMBEDDING_MODEL: string;
}): Models {
  const registry = createProviderRegistry({ anthropic, openai, voyage });
  return {
    intake: registry.languageModel(ids.INTAKE_MODEL as ModelId),
    reasoning: registry.languageModel(ids.REASONING_MODEL as ModelId),
    embedding: registry.embeddingModel(ids.EMBEDDING_MODEL as ModelId),
  };
}
