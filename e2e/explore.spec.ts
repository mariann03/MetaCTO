import { expect, test } from "@playwright/test";
import { asSubmitter, submit } from "./helpers";

test("a customer searches Explore, filters by status and opens a Problem", async ({
  page,
}) => {
  const need = `explore search ${Date.now()}`;
  const statement = `Customers need ${need}.`;
  await asSubmitter(page, 6);
  await submit(page, need);

  await page.goto("/");
  await page.getByLabel("Search problems").fill(need);
  await page.getByRole("button", { name: "Search" }).click();
  const results = page.getByRole("list", { name: "Closest problems" });
  await expect(results.getByRole("listitem").first()).toHaveAccessibleName(
    statement,
  );

  // Planned hides the new Problem; Open (below) shows it again.
  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Planned" }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/status=planned/);
  await expect(page.getByRole("link", { name: statement })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: "Open" }).click();
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: statement }).click();

  const problem = page.getByRole("article");
  await expect(problem.getByRole("heading", { level: 1 })).toHaveText(
    statement,
  );
  await expect(problem.getByText("Open", { exact: true })).toBeVisible();
  await expect(problem.getByText("1 supporter")).toBeVisible();
  await expect(problem.getByText("No public rationale yet.")).toBeVisible();
  await expect(problem.getByText("No updates yet.")).toBeVisible();
  const request = problem.getByRole("listitem").filter({ hasText: need });
  // Anonymized: the customer's segment, never their name.
  await expect(request).toContainText(
    /An? (SMB|Mid-market|Enterprise) customer/,
  );
  await expect(request).not.toContainText("Amara");
});
