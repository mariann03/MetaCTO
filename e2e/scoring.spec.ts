import { expect, test } from "@playwright/test";
import { asPm, asSubmitter, submit, weighOnly } from "./helpers";

test("a PM rescores stale Problems, overrides a score with a reason, and the ranking follows", async ({
  page,
}) => {
  const need = `scoring ${Date.now()}`;
  const statement = `Customers need ${need}.`;
  await asSubmitter(page, 7);
  await submit(page, need);

  await asPm(page);
  await page.goto("/priorities");
  const row = page.getByRole("row").filter({ hasText: statement });
  await expect(row).toContainText("Not scored");
  await page.getByRole("button", { name: /Rescore all stale/ }).click();
  await expect(page.getByRole("status")).toContainText("in the background");
  // Scoring runs after the response; reload until it lands.
  await expect(async () => {
    await page.reload();
    await expect(row).not.toContainText("Not scored", { timeout: 1000 });
  }).toPass();
  await expect(row).toContainText("3/5");

  await row.getByRole("link", { name: statement }).click();
  const urgency = page.getByRole("listitem", { name: "Urgency" });
  await expect(urgency).toContainText("AI: Fake rationale");
  await urgency.getByRole("button", { name: "Override Urgency" }).click();
  await urgency.getByRole("combobox", { name: "Your score" }).click();
  await page.getByRole("option", { name: "5" }).click();
  await urgency
    .getByLabel("Why? (required)")
    .fill("Two enterprise renewals hinge on it.");
  await urgency.getByRole("button", { name: "Save override" }).click();
  await expect(urgency).toContainText(
    "Overridden to 5/5: Two enterprise renewals hinge on it.",
  );
  await expect(urgency).toContainText("AI 3");

  // A rescore replaces the AI's judgement but keeps the PM's.
  await page.getByRole("button", { name: "Rescore" }).click();
  await expect(page.getByText("Rescored.")).toBeVisible();
  await expect(urgency).toContainText("5/5");

  await page.goto("/priorities");
  await weighOnly(page, "Urgency");
  await expect(page.getByRole("row").nth(1)).toContainText(statement);
});
