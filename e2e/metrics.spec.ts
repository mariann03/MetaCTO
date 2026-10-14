import { expect, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

test("a PM sees business metrics from the event log and the latest evaluation", async ({
  page,
}) => {
  await asSubmitter(page, 11);
  await submit(page, `metrics ${Date.now()}`);

  await asPm(page);
  await page.getByRole("link", { name: "Metrics", exact: true }).click();
  // At least this submission counts toward deflection's denominator.
  await expect(page.getByLabel("Deflection rate")).toContainText(
    /\d+ of [1-9]\d* needs/,
  );
  for (const title of [
    "Missed-duplicate rate",
    "Hands-off rate",
    "Time to triaged",
    "Time to first update",
    "Grouping override rate",
    "Score override rate",
  ])
    await expect(page.getByLabel(title)).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Latest evaluation" }),
  ).toContainText("Grouped correctly");
});
