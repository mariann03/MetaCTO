import { expect, type Page, test } from "@playwright/test";

async function submit(page: Page, title: string, description: string) {
  await page.goto("/submit");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("What do you need, and why?").fill(description);
  await page.getByRole("button", { name: "Submit request" }).click();
}

test("a request for an existing need is grouped and can be split out", async ({
  page,
}) => {
  const title = "multi-currency invoices";
  const description = "We invoice EU customers and need to bill them in euros.";
  await submit(page, title, description);
  await expect(
    page.getByRole("status").filter({ hasText: "New problem" }),
  ).toContainText("New problem created");

  await submit(page, title, description);
  const result = page.getByRole("status").filter({ hasText: "Grouped into" });
  await expect(result).toContainText(
    "Grouped into: Customers need multi-currency invoices.",
  );

  await result
    .getByRole("button", { name: "Not the same? Split it out" })
    .click();
  await expect(result).toContainText(
    "Thanks. A product manager will review the grouping.",
  );
});
