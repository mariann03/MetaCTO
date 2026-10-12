import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";

export { jsonResult } from "@/ai/fake";

import type { Models } from "@/ai/models";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";

type Generate = MockLanguageModelV4["doGenerate"];

/** Unit vector pointing along `axis`; equal axes give similarity 1, different axes 0. */
export function axisVector(axis: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === axis ? 1 : 0,
  );
}

/** Models whose language responses and embeddings are scripted per test. */
export function scriptedModels({
  generate,
  embed = () => axisVector(0),
}: {
  generate: Generate;
  embed?: (text: string) => number[];
}) {
  const language = new MockLanguageModelV4({ doGenerate: generate });
  const embedding = new MockEmbeddingModelV4({
    provider: "test",
    modelId: "test-embedding",
    doEmbed: async ({ values }) => ({
      embeddings: values.map(embed),
      warnings: [],
    }),
  });
  const models: Models = { intake: language, reasoning: language, embedding };
  return { models, language };
}

/** Unit vector whose cosine similarity with `axisVector(0)` is exactly `similarity`. */
export function similarVector(similarity: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity ** 2) : 0,
  );
}

/** Problem ids offered to the model as candidates, read from the prompt it received. */
export function candidateIds(prompt: unknown): number[] {
  return [...JSON.stringify(prompt).matchAll(/<candidate id=\\"(\d+)\\"/g)].map(
    (m) => Number(m[1]),
  );
}
