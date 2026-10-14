import { describe, expect, test } from "bun:test";
import { loadRequestFixtures } from "./fixtures";

describe("the vscode eval dataset", () => {
  test("holds 300-500 real feature requests whose labeled duplicates share an original", async () => {
    const requests = await loadRequestFixtures("vscode");

    expect(requests.length).toBeGreaterThanOrEqual(300);
    expect(requests.length).toBeLessThanOrEqual(500);
    const problems = new Set(requests.map((r) => r.problemKey));
    // At least 100 requests duplicate an earlier one, so grouping is measurable.
    expect(requests.length - problems.size).toBeGreaterThanOrEqual(100);
  });

  test("keeps each Problem in one split, so a duplicate is judged with its original", async () => {
    const splitOf = new Map<string | null, string>();
    for (const { problemKey, split } of await loadRequestFixtures("vscode")) {
      expect(splitOf.get(problemKey) ?? split).toBe(split);
      splitOf.set(problemKey, split);
    }
  });

  test("names no author: one anonymous author, no @handles", async () => {
    for (const r of await loadRequestFixtures("vscode")) {
      expect(r.authorKey).toBe("oss");
      expect(`${r.title} ${r.description}`).not.toMatch(/@(?!someone\b)[\w-]+/);
    }
  });
});
