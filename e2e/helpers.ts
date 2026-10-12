import { expect, type Page } from "@playwright/test";
import users from "../data/fixtures/users.json";

const submitters = users
  .filter((u) => u.role === "submitter")
  .map((u) => u.name);

/** Switches the acting user with the header switcher. */
export async function actAs(page: Page, option: RegExp) {
  await page.goto("/");
  const switcher = page.getByRole("combobox", { name: "Acting as" });
  await switcher.click();
  const choice = page.getByRole("option", { name: option }).first();
  const label = (await choice.textContent())?.trim() ?? "";
  await choice.click();
  await expect(switcher).toContainText(label);
}

/**
 * Acts as the nth fixture submitter. Specs use different ones, so each stays under the
 * hourly submission limit; the default user (0) is the one specs get without switching.
 */
export const asSubmitter = (page: Page, n: number) =>
  actAs(page, new RegExp(`^${submitters[n]} ·`));

export const asPm = (page: Page) => actAs(page, /· PM$/);

/** Writes a request, goes Next and submits it, then waits for the result. */
export async function submit(
  page: Page,
  title: string,
  description = "We need this every month for our bookkeeping.",
) {
  await page.goto("/submit");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("What do you need, and why?").fill(description);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();
}
