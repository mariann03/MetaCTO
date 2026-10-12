import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import type { Models } from "./models";

export const FAKE_EMBEDDING_DIMENSIONS = 1024;

// Same text always maps to the same unit vector, so similarity is reproducible.
export function fakeEmbedding(text: string): number[] {
  let seed = 2166136261;
  for (const ch of text)
    seed = Math.imul(seed ^ (ch.codePointAt(0) ?? 0), 16777619);
  const vector = Array.from({ length: FAKE_EMBEDDING_DIMENSIONS }, () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...vector);
  return vector.map((v) => v / norm);
}

export function createFakeModels(): Models {
  const language = new MockLanguageModelV4({
    provider: "fake",
    modelId: "fake-language",
    doGenerate: async () => {
      throw new Error("Fake language model has no scripted response yet");
    },
  });
  return {
    intake: language,
    reasoning: language,
    embedding: new MockEmbeddingModelV4({
      provider: "fake",
      modelId: "fake-embedding",
      doEmbed: async ({ values }) => ({
        embeddings: values.map(fakeEmbedding),
        warnings: [],
      }),
    }),
  };
}
