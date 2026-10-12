import { expect, test } from "@playwright/test";

test("submitting a request creates a new problem listed in My requests", async ({
  page,
}) => {
  await page.goto("/submit");
  await page.getByLabel("Title").fill("bank feed reconnection alerts");
  await page
    .getByLabel("What do you need, and why?")
    .fill("Our bank feed silently disconnects and we miss transactions.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(page.getByRole("status")).toContainText(
    "New problem created: Customers need bank feed reconnection alerts.",
  );

  await page.getByRole("link", { name: "My requests" }).click();
  const item = page
    .getByRole("listitem")
    .filter({ hasText: "bank feed reconnection alerts" });
  await expect(item).toContainText("Submitted");
  await expect(item).toContainText(
    "Problem: Customers need bank feed reconnection alerts.",
  );
});

test("a request whose analysis fails is kept as a draft and can be submitted again", async ({
  page,
}) => {
  await page.goto("/submit");
  await page.getByLabel("Title").fill("export to excel [flaky]");
  await page
    .getByLabel("What do you need, and why?")
    .fill("Our accountant needs the ledger in Excel every month.");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(
    page.getByRole("alert").filter({ hasText: "draft" }),
  ).toContainText("saved as a draft in My requests");

  await page.goto("/my-requests");
  const draft = page
    .getByRole("listitem")
    .filter({ hasText: "export to excel [flaky]" });
  await expect(draft).toContainText("Draft");
  await draft.getByRole("button", { name: "Submit again" }).click();

  // Once submitted, the row re-renders with its Problem instead of the draft form.
  await expect(draft).toContainText("Submitted");
  await expect(draft).toContainText("Problem: Customers need export to excel.");
});

test("a request that fails validation keeps what was typed", async ({
  page,
}) => {
  await page.goto("/submit");
  await page.getByLabel("Title").fill("csv export");
  await page.getByLabel("What do you need, and why?").fill("too short");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Submit request" }).click();

  await expect(
    page.getByText("Describe what you need in a sentence or two."),
  ).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("csv export");
  await expect(page.getByLabel("What do you need, and why?")).toHaveValue(
    "too short",
  );
});
