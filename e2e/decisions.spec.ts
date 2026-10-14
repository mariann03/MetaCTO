import { expect, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

test("a PM records a decision and approves the update, and the supporter is notified", async ({
  page,
}) => {
  const need = `decision ${Date.now()}`;
  const statement = `Customers need ${need}.`;
  await asSubmitter(page, 8);
  await submit(page, need);

  await asPm(page);
  await page.goto("/");
  await page.getByRole("link", { name: statement }).click();
  const decide = page.getByRole("region", { name: "Decide and update" });
  await decide.getByRole("combobox", { name: "Decision" }).click();
  await page.getByRole("option", { name: "Planned" }).click();
  await decide
    .getByLabel("Public rationale")
    .fill("Asked for by many teams; it fits this quarter.");
  await decide.getByRole("button", { name: "Record decision" }).click();
  await expect(decide.getByRole("status")).toContainText("Decision recorded");

  const customer = decide.getByRole("form", { name: /Customer update/ });
  await expect(customer.getByRole("textbox")).toHaveValue(
    "Fake update: we have decided on this problem.",
  );
  await expect(
    decide.getByRole("form", { name: /Internal update/ }).getByRole("textbox"),
  ).toHaveValue("Fake internal update with talking points.");
  await customer
    .getByRole("textbox")
    .fill("Good news: we plan to build this next quarter.");
  await customer.getByRole("button", { name: "Approve" }).click();
  await expect(customer).toHaveCount(0);

  await asSubmitter(page, 8);
  await page.goto("/notifications");
  const notification = page
    .getByRole("listitem")
    .filter({ hasText: statement });
  await expect(notification).toContainText(
    "Good news: we plan to build this next quarter.",
  );
  await notification.getByRole("link", { name: statement }).click();
  const problem = page.getByRole("article");
  await expect(problem.getByText("Planned", { exact: true })).toBeVisible();
  await expect(problem.getByRole("region", { name: "Decision" })).toContainText(
    "Asked for by many teams; it fits this quarter.",
  );
  await expect(problem.getByRole("region", { name: "Updates" })).toContainText(
    "Good news: we plan to build this next quarter.",
  );
  await expect(
    problem.getByRole("region", { name: "Decide and update" }),
  ).toHaveCount(0);
});
