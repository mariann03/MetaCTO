import { expect, type Page, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

const COLUMNS = { Reach: 3, "Business value": 4, Score: 5 } as const;

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
  const reach = page.getByRole("slider", { name: "Reach weight" });
  const value = page.getByRole("slider", { name: "Business value weight" });

  await reach.press("End");
  await value.press("Home");
  await expect(reach).toHaveValue("10");
  await expect(value).toHaveValue("0");
  await expectRankedBy(page, "Reach");

  await reach.press("Home");
  await value.press("End");
  await expect(reach).toHaveValue("0");
  await expect(value).toHaveValue("10");
  await expectRankedBy(page, "Business value");
});
