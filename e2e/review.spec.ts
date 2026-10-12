import { expect, type Page, test } from "@playwright/test";
import users from "../data/fixtures/users.json";

// Not the default user, whose submissions other specs already count toward the rate limit.
const submitter = users.filter((u) => u.role === "submitter")[1]?.name ?? "";

async function actAs(page: Page, option: RegExp) {
  await page.goto("/");
  const switcher = page.getByRole("combobox", { name: "Acting as" });
  await switcher.click();
  const choice = page.getByRole("option", { name: option }).first();
  const label = (await choice.textContent())?.trim() ?? "";
  await choice.click();
  await expect(switcher).toContainText(label);
}

const asSubmitter = (page: Page) => actAs(page, new RegExp(`^${submitter} ·`));
const asPm = (page: Page) => actAs(page, /· PM$/);

/** Submits a request as the current user and waits for its result. */
async function submit(page: Page, title: string) {
  await page.goto("/submit");
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("What do you need, and why?")
    .fill("We need this every month for our bookkeeping.");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();
}

async function openQueueItem(page: Page, title: string) {
  await page.goto("/review");
  return page.getByRole("listitem", { name: title });
}

// Titles are unique per run, so a retried test starts new needs.
const unique = (name: string) => `${name} ${Date.now()}`;

test("a PM accepts a new problem", async ({ page }) => {
  const title = unique("review accept");
  await asSubmitter(page);
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
  await asSubmitter(page);
  await submit(page, target);
  await submit(page, source);

  await asPm(page);
  const item = await openQueueItem(page, source);
  await item.getByRole("combobox", { name: "Move to problem" }).click();
  await page.getByRole("option", { name: `Customers need ${target}.` }).click();
  await item.getByRole("button", { name: "Move" }).click();
  await expect(item).toHaveCount(0);

  await asSubmitter(page);
  await page.goto("/my-requests");
  await expect(
    page.getByText(`Problem: Customers need ${target}.`),
  ).toHaveCount(2);
});

test("a PM splits a disputed grouping into a new problem", async ({ page }) => {
  const title = unique("review split");
  await asSubmitter(page);
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
