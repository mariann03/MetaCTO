import { expect, type Page, test } from "@playwright/test";
import { asPm, asSubmitter, submit, weighOnly } from "./helpers";

const COLUMNS = { Reach: 3, "Business value": 4, Score: 8 } as const;

/** One column's score in each ranked row, top to bottom. */
async function scores(page: Page, name: keyof typeof COLUMNS) {
  const cells = await page
    .locator(`tbody tr td:nth-child(${COLUMNS[name]})`)
    .evaluateAll((tds) =>
      tds.map((td) => (td.firstElementChild ?? td).textContent),
    );
  return cells.map(Number);
}

/** With one criterion weighted, the score is that criterion's (give or take rounding), highest first. */
async function expectRankedBy(page: Page, name: keyof typeof COLUMNS) {
  const criterion = await scores(page, name);
  const score = await scores(page, "Score");
  expect(score.map((s, i) => Math.abs(s - (criterion[i] ?? -1)) <= 1)).toEqual(
    criterion.map(() => true),
  );
  expect(score).toEqual(score.toSorted((a, b) => b - a));
}

test("a PM weighs the criteria and the ranking follows", async ({ page }) => {
  const needs = [4, 5].map((n) => `priorities ${n} ${Date.now()}`);
  for (const [i, need] of needs.entries()) {
    await asSubmitter(page, 4 + i);
    await submit(page, need);
  }

  await asPm(page);
  await page.goto("/priorities");
  for (const need of needs)
    await expect(
      page.getByRole("cell", { name: `Customers need ${need}.` }),
    ).toBeVisible();
  await weighOnly(page, "Reach");
  await expectRankedBy(page, "Reach");

  await weighOnly(page, "Business value");
  await expectRankedBy(page, "Business value");
});
