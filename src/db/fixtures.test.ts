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

  test("names nobody: one anonymous author, no handles, profile links, home paths or emails", async () => {
    for (const r of await loadRequestFixtures("vscode")) {
      const text = `${r.title} ${r.description}`;
      expect(r.authorKey).toBe("oss");
      // A mention: @ at a word start, not an email or a package like @types/node.
      expect(text).not.toMatch(
        // Ending a sentence counts; an email or a package like @types/node does not.
        /(^|[\s(])@(?!someone\b)[A-Za-z\d-]+(?![\w/-]|\.\w)/,
      );
      // github.com/<user> is a person; only microsoft's own links may stay.
      expect(text).not.toMatch(/github\.com\/(?!microsoft\b|someone\b)[\w-]+/i);
      // A one-word name under a sign-off, wherever it sits.
      expect(text).not.toMatch(
        /\n\s*(Best|Thanks|Regards|Cheers)[^\n]{0,30}\r?\n\s*[A-Za-z][\w-]{1,20}\s*(\r?\n|$)/i,
      );
      expect(text).not.toMatch(/(\/Users|\/home|\\Users)[\\/](?!someone\b)\w/);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });
});
