import { expect, test } from "@playwright/test";
import { actAs, asPm, asSubmitter, submit } from "./helpers";

test("a request our team wrote is shown to our team, never to customers", async ({
  page,
}) => {
  const need = `renewal risk ${Date.now()}`;
  const statement = `Customers need ${need}.`;
  await actAs(page, /^Owen Prescott \(Sales\)/);
  await submit(page, need, "Acme Corp ($285k ARR) says they will churn.");
  await page.goto("/");
  await page.getByLabel("Search problems").fill(need);
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: statement }).click();
  await page.waitForURL(/\/problems\/\d+$/);
  const url = page.url();

  const problem = page.getByRole("article");
  const request = problem.getByRole("listitem").filter({ hasText: need });
  await expect(request).toContainText("Our team");

  await asSubmitter(page, 8);
  await page.goto(url);
  await expect(problem.getByRole("heading", { level: 1 })).toHaveText(
    statement,
  );
  await expect(request).toHaveCount(0);
  await expect(problem).not.toContainText("$285k ARR");

  await asPm(page);
  await page.goto(url);
  await expect(request).toContainText("Our team");
  await expect(request).toContainText("$285k ARR");
});
