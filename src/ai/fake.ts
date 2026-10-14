import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { EMBEDDING_DIMENSIONS } from "@/db/schema";
import { ANALYSIS_ATTEMPTS } from "@/domain/intake";
import type { Models } from "./models";

// Same text always maps to the same unit vector, so similarity is reproducible.
export function fakeEmbedding(text: string): number[] {
  let seed = 2166136261;
  for (const ch of text)
    seed = Math.imul(seed ^ (ch.codePointAt(0) ?? 0), 16777619);
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    return seed / 2 ** 32 - 0.5;
  });
  const norm = Math.hypot(...vector);
  return vector.map((v) => v / norm);
}

type Generate = MockLanguageModelV4["doGenerate"];

/** A language-model response carrying `value` as JSON text, as structured output expects. */
export function jsonResult(value: unknown): Awaited<ReturnType<Generate>> {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
    warnings: [],
  };
}

// Analysis attempts per "[flaky]" title: the first submission exhausts its retries,
// the resubmission succeeds, so E2E can exercise the draft path.
const flakyAttempts = new Map<string, number>();

/** Deterministic intake analysis derived from the request title in the prompt. */
const fakeGenerate: Generate = async ({ prompt }) => {
  const text = JSON.stringify(prompt);
  // Statement refinement: the fake never has anything to add.
  if (text.includes("<current_statement>"))
    return jsonResult({ changed: false, statement: "" });

  // Scoring: middling scores citing the first request it was shown.
  if (text.includes("<strategy>")) {
    const first = Number(/<request id=\\"(\d+)\\"/.exec(text)?.[1]);
    const judgement = {
      rationale: "Fake rationale",
      score: 3,
      citedRequestIds: [first],
    };
    return jsonResult({
      strategicFit: judgement,
      urgency: judgement,
      effort: judgement,
    });
  }

  const title = /<title>([\s\S]*?)<\/title>/.exec(text)?.[1] ?? "";
  if (title.includes("[flaky]")) {
    const attempts = (flakyAttempts.get(title) ?? 0) + 1;
    flakyAttempts.set(title, attempts);
    if (attempts <= ANALYSIS_ATTEMPTS) throw new Error("Fake analysis failure");
  }
  const need = title.replace("[flaky]", "").trim();
  const problemStatement = `Customers need ${need}.`;
  // Asked for a verdict, the fake matches a candidate only if it states the same need.
  const candidate = [
    ...text.matchAll(/<candidate id=\\"(\d+)\\">(.*?)<\/candidate>/g),
  ].find((m) => m[2] === problemStatement)?.[1];
  // Not "<candidates>": the intake instructions mention that tag on every call.
  const asked = text.includes("<candidate id=");
  return jsonResult({
    problemStatement,
    underlyingProblem: need,
    proposedSolution: "",
    persona: "Customer",
    severity: "medium",
    match: asked
      ? {
          verdict: candidate ? "same_problem" : "different",
          problemId: candidate ? Number(candidate) : null,
          rationale: "Fake verdict",
        }
      : null,
  });
};

export function createFakeModels(): Models {
  const language = new MockLanguageModelV4({
    provider: "fake",
    modelId: "fake-language",
    doGenerate: fakeGenerate,
  });
  return {
    intake: language,
    reasoning: language,
    embedding: new MockEmbeddingModelV4({
      provider: "fake",
      modelId: "fake-embedding",
      // Only the title counts (the text before the blank line), as in the fake analysis,
      // so searching Explore for a request's title finds it.
      doEmbed: async ({ values }) => ({
        embeddings: values.map((v) => fakeEmbedding(v.split("\n\n")[0] ?? v)),
        warnings: [],
      }),
    }),
  };
}
