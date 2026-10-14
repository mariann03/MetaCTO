import { describe, expect, test } from "bun:test";
import {
  axisVector,
  candidateIds,
  jsonResult,
  scriptedModels,
  similarVector,
} from "../../test/ai";
import {
  collectObservations,
  type Observation,
  retrievalRecall,
  score,
  tune,
} from "./evaluation";
import { PROVISIONAL_THRESHOLDS } from "./intake";

/** One replayed request: its true cluster, the best candidate, and the model's verdict on it. */
function obs(
  truth: string,
  best: { cluster: string; similarity: number } | null,
  verdict: "same_problem" | "related_but_different" | "different" | null = null,
  {
    truthExisted = true,
    split = "train",
  }: { truthExisted?: boolean; split?: Observation["split"] } = {},
): Observation {
  return {
    key: `${truth}-${best?.similarity ?? "none"}`,
    split,
    truth,
    truthExisted,
    candidates: best ? [best] : [],
    verdict: verdict && {
      verdict,
      cluster: verdict === "different" ? null : (best?.cluster ?? null),
    },
  };
}

describe("score", () => {
  test("counts each tier and how often it was right", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.9 }), // high, right
      obs("b", { cluster: "a", similarity: 0.9 }), // high, wrong
      obs("c", { cluster: "c", similarity: 0.7 }), // medium, right
      obs("d", null, null, { truthExisted: false }), // low, rightly new
      obs("e", { cluster: "x", similarity: 0.3 }), // low, but "e" existed: missed
    ];

    const m = score(observations, "similarity-only", { low: 0.6, high: 0.85 });

    expect(m.high).toEqual({ count: 2, correct: 1, precision: 0.5 });
    expect(m.medium).toEqual({ count: 1, correct: 1, precision: 1 });
    expect(m.low).toEqual({ count: 2, correct: 1, precision: 0.5 });
    expect(m.attachable).toBe(4);
    expect(m.highRecall).toBe(0.25);
    expect(m.attachRecall).toBe(0.5);
    // Of the requests that were truly new, the share that started a new Problem.
    expect(m.newRecall).toBe(1);
  });

  test("hybrid follows the model's verdict", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.9 }, "same_problem"),
      obs("b", { cluster: "a", similarity: 0.95 }, "different"),
      obs("c", { cluster: "c", similarity: 0.4 }, "related_but_different"),
    ];

    const m = score(observations, "hybrid", { low: 0.5, high: 0.8 });

    expect(m.high).toEqual({ count: 1, correct: 1, precision: 1 });
    expect(m.low.count).toBe(1);
    expect(m.medium).toEqual({ count: 1, correct: 1, precision: 1 });
  });

  test("an empty tier has no precision", () => {
    const m = score([], "hybrid", { low: 0.5, high: 0.8 });
    expect(m.high.precision).toBeNull();
    expect(m.highRecall).toBeNull();
  });
});

describe("retrievalRecall", () => {
  test("is the share of groupable requests whose Problem was among the candidates", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.4 }),
      obs("b", { cluster: "x", similarity: 0.9 }),
      obs("c", null, null, { truthExisted: false }),
    ];

    expect(retrievalRecall(observations)).toBe(0.5);
  });
});

describe("tune", () => {
  test("picks the lowest high threshold whose precision is confidently at least 95%", () => {
    const observations = [
      ...Array.from({ length: 80 }, (_, i) =>
        obs(`k${i}`, { cluster: `k${i}`, similarity: 0.9 }, "same_problem"),
      ),
      obs("w", { cluster: "x", similarity: 0.8 }, "same_problem"),
    ];

    // 80/80 at 0.81+ is confidently precise; adding the miss at 0.80 is not.
    const tuned = tune(observations, "hybrid");
    expect(tuned.high).toBeCloseTo(0.81, 5);
    expect(tuned.basis).toBe("tuned");
  });

  test("with too few cases to be confident, keeps the provisional threshold", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.9 }, "same_problem"),
      obs("b", { cluster: "b", similarity: 0.6 }, "same_problem"),
      obs("c", { cluster: "c", similarity: 0.4 }, "same_problem"),
    ];

    expect(tune(observations, "hybrid")).toMatchObject({
      high: PROVISIONAL_THRESHOLDS.hybrid.high,
      basis: "provisional",
    });
  });

  test("never auto-groups when no threshold is precise enough", () => {
    const observations = [
      obs("a", { cluster: "x", similarity: 0.99 }, "same_problem"),
    ];

    const tuned = tune(observations, "hybrid");
    expect(tuned.high).toBeGreaterThan(1);
    expect(tuned.basis).toBe("never");
  });

  test("in similarity-only mode, sets the review threshold where grouping is most accurate", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.95 }),
      obs("b", { cluster: "b", similarity: 0.7 }),
      obs("c", { cluster: "c", similarity: 0.65 }),
      obs("d", { cluster: "x", similarity: 0.5 }),
      obs("e", { cluster: "x", similarity: 0.45 }, null, {
        truthExisted: false,
      }),
    ];

    const tuned = tune(observations, "similarity-only");

    // Every low from 0.51 to 0.65 groups a, b and c; ties keep the highest (fewest reviews).
    expect(tuned.low).toBeCloseTo(0.65, 5);
    expect(tuned.low).toBeLessThanOrEqual(tuned.high);
  });

  test("only train observations are used for tuning", () => {
    const observations = [
      obs("a", { cluster: "a", similarity: 0.9 }, "same_problem"),
      obs("b", { cluster: "x", similarity: 0.95 }, "same_problem", {
        split: "holdout",
      }),
    ];

    expect(tune(observations, "hybrid").high).toBeLessThanOrEqual(0.9);
  });
});

describe("collectObservations", () => {
  test("replays each request against the Problems the earlier requests should have formed", async () => {
    const { models, language } = scriptedModels({
      embed: (text) =>
        text.startsWith("Export for accountant")
          ? similarVector(0.9)
          : text.startsWith("Payroll")
            ? axisVector(1)
            : axisVector(0),
      generate: async ({ prompt }) => {
        const [first] = candidateIds(prompt);
        return jsonResult({
          problemStatement: `Statement for ${JSON.stringify(prompt).includes("Payroll") ? "payroll" : "exports"}`,
          underlyingProblem: "x",
          proposedSolution: "",
          persona: "Owner",
          severity: "low",
          ...(first !== undefined && {
            match: {
              verdict: "same_problem",
              problemId: first,
              rationale: "r",
            },
          }),
        });
      },
    });

    const observations = await collectObservations(models, [
      {
        key: "r-1",
        problemKey: "p-1",
        split: "train",
        title: "Year-end export",
        description: "Books for my accountant.",
      },
      {
        key: "r-2",
        problemKey: "p-1",
        split: "holdout",
        title: "Export for accountant",
        description: "Same need.",
      },
      {
        key: "r-3",
        problemKey: null,
        split: "train",
        title: "Payroll",
        description: "Run payroll.",
      },
    ]);

    expect(observations.map((o) => [o.key, o.truth, o.truthExisted])).toEqual([
      ["r-1", "p-1", false],
      ["r-2", "p-1", true],
      ["r-3", "r-3", false],
    ]);
    expect(observations[0]?.candidates).toEqual([]);
    expect(observations[0]?.verdict).toBeNull();
    expect(observations[1]?.candidates).toEqual([
      { cluster: "p-1", similarity: expect.closeTo(0.9, 5) },
    ]);
    expect(observations[1]?.verdict).toEqual({
      verdict: "same_problem",
      cluster: "p-1",
    });
    // The model sees each existing Problem's statement, as written for its first request.
    expect(JSON.stringify(language.doGenerateCalls[1]?.prompt)).toContain(
      "Statement for exports",
    );
    expect(observations[2]?.candidates[0]?.cluster).toBe("p-1");
  });
});

describe("collectObservations with another intake setup", () => {
  test("offers the model as many candidates as the setup asks, at its reasoning level", async () => {
    const { models, language } = scriptedModels({
      embed: (text) => axisVector(Number(text.split(" ")[1])),
      generate: async () =>
        jsonResult({
          problemStatement: "s",
          underlyingProblem: "x",
          proposedSolution: "",
          persona: "Owner",
          severity: "low",
          match: { verdict: "different", problemId: null, rationale: "r" },
        }),
    });
    // Four different needs on four axes, so each is a candidate for the last request.
    const requests = [1, 2, 3, 4, 5].map((n) => ({
      key: `r-${n}`,
      problemKey: null,
      split: "train" as const,
      title: `Need ${n}`,
      description: "",
    }));

    const observations = await collectObservations(models, requests, {
      candidates: 2,
      reasoning: "low",
    });

    expect(observations[4]?.candidates).toHaveLength(2);
    expect(language.doGenerateCalls.map((c) => c.reasoning)).toEqual(
      Array(5).fill("low"),
    );
  });
});
