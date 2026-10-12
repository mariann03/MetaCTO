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

test("a PM weighs the criteria and the ranking follows", async ({ page }) => {
  for (const n of [4, 5]) {
    await asSubmitter(page, n);
    await submit(page, `priorities ${n} ${Date.now()}`);
  }

  await asPm(page);
  await page.goto("/priorities");
  const reach = page.getByRole("slider", { name: "Reach weight" });
  const value = page.getByRole("slider", { name: "Business value weight" });

  // Only Reach counts: the score is the Reach score, highest first.
  await reach.press("End");
  await value.press("Home");
  await expect(value).toHaveValue("0");
  const byReach = await scores(page, "Reach");
  expect(byReach.length).toBeGreaterThanOrEqual(2);
  expect(await scores(page, "Score")).toEqual(byReach);
  expect(byReach).toEqual(byReach.toSorted((a, b) => b - a));

  // Only Business value counts.
  await reach.press("Home");
  await value.press("End");
  await expect(reach).toHaveValue("0");
  const byValue = await scores(page, "Business value");
  expect(await scores(page, "Score")).toEqual(byValue);
  expect(byValue).toEqual(byValue.toSorted((a, b) => b - a));
});
