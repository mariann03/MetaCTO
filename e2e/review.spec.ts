import { expect, type Page, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

async function openQueueItem(page: Page, title: string) {
  await page.goto("/review");
  return page.getByRole("listitem", { name: title });
}

// Titles are unique per run, so a retried test starts new needs.
const unique = (name: string) => `${name} ${Date.now()}`;

test("a PM accepts a new problem", async ({ page }) => {
  const title = unique("review accept");
  await asSubmitter(page, 1);
  await submit(page, title);

  await asPm(page);
  const item = await openQueueItem(page, title);
  await expect(item).toContainText("New problem");
  await item.getByRole("button", { name: "Accept" }).click();
  await expect(item).toHaveCount(0);
});

test("a PM moves a request into another problem", async ({ page }) => {
  const target = unique("review move target");
  const source = unique("review move source");
  await asSubmitter(page, 1);
  await submit(page, target);
  await submit(page, source);

  await asPm(page);
  const item = await openQueueItem(page, source);
  await item.getByRole("combobox", { name: "Move to problem" }).click();
  await page.getByRole("option", { name: `Customers need ${target}.` }).click();
  await item.getByRole("button", { name: "Move" }).click();
  await expect(item).toHaveCount(0);

  await asSubmitter(page, 1);
  await page.goto("/my-requests");
  await expect(
    page.getByText(`Problem: Customers need ${target}.`),
  ).toHaveCount(2);
});

test("a PM splits a disputed grouping into a new problem", async ({ page }) => {
  const title = unique("review split");
  await asSubmitter(page, 1);
  await submit(page, title);
  await submit(page, title);
  await page
    .getByRole("status")
    .filter({ hasText: "Grouped into" })
    .getByRole("button", { name: "Not the same? Split it out" })
    .click();
  await expect(
    page.getByText("Thanks. A product manager will review the grouping."),
  ).toBeVisible();

  await asPm(page);
  const items = await openQueueItem(page, title);
  const disputed = items.filter({ hasText: "Split requested" });
  await disputed
    .getByRole("button", { name: "Split into a new problem" })
    .click();
  await expect(disputed).toHaveCount(0);
  // The first request still awaits review as the problem it started.
  await expect(items).toHaveCount(1);
  await expect(items).toContainText("New problem");
});
