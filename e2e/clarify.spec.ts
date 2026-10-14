import { expect, type Page, test } from "@playwright/test";
import { asPm, asSubmitter } from "./helpers";

const QUESTION = "What are you trying to achieve?";

/** Writes a request and goes Next, to the confirm step. */
async function writeAndNext(page: Page, title: string) {
  await page.goto("/submit");
  await page.getByLabel("Title").fill(title);
  await page
    .getByLabel("What do you need, and why?")
    .fill("Please add this integration to the product.");
  await page.getByRole("button", { name: "Next" }).click();
}

async function setMaxQuestions(page: Page, option: string) {
  await asPm(page);
  await page.goto("/settings");
  await page
    .getByRole("combobox", { name: "Clarifying questions per request" })
    .click();
  await page.getByRole("option", { name: option, exact: true }).click();
  const form = page.locator("form").filter({ hasText: "Clarifying questions" });
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("status")).toHaveText("Saved.");
}

test("a submitter answers or skips the clarifying question, and a PM can turn it off", async ({
  page,
}) => {
  const stamp = Date.now();
  await asSubmitter(page, 13);

  // Answered: the answer goes in with the request.
  const answered = `zapier [solution] ${stamp}`;
  await writeAndNext(page, answered);
  await page.getByLabel(QUESTION).fill("We retype every invoice by hand.");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();
  await page.goto("/");
  await page.getByRole("link", { name: `Customers need ${answered}.` }).click();
  await expect(page.getByRole("article")).toContainText(
    `${QUESTION} We retype every invoice by hand.`,
  );

  // Skipped: the question goes away and the request goes in without it.
  await writeAndNext(page, `sheets [solution] ${stamp}`);
  await page.getByRole("button", { name: "Skip this question" }).click();
  await expect(page.getByLabel(QUESTION)).toHaveCount(0);
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("status").first()).toBeVisible();

  // Off: no question at all.
  await setMaxQuestions(page, "None (off)");
  await asSubmitter(page, 13);
  await writeAndNext(page, `slack [solution] ${stamp}`);
  await expect(
    page.getByRole("button", { name: "Submit request" }),
  ).toBeVisible();
  await expect(page.getByText("Checking whether")).toHaveCount(0);
  await expect(page.getByLabel(QUESTION)).toHaveCount(0);
  await setMaxQuestions(page, "1");
});
