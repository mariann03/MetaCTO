import { expect, test } from "@playwright/test";
import { asSubmitter, submit } from "./helpers";

test("a submitter supports a matching problem instead of filing a duplicate", async ({
  page,
}) => {
  const title = `deflect payroll ${Date.now()}`;
  const description = "We run payroll by hand every month and it takes a day.";
  const statement = `Customers need ${title}.`;
  await asSubmitter(page, 2);
  await submit(page, title, description);

  await asSubmitter(page, 3);
  await page.goto("/submit");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("What do you need, and why?").fill(description);
  // Matches appear after a typing pause, without pressing Next.
  const match = page
    .getByRole("region", { name: "Similar problems" })
    .getByRole("listitem", { name: statement });
  await expect(match).toContainText("1 supporter");
  await match.getByRole("button", { name: "+1, this affects me" }).click();
  await match
    .getByLabel("How does this affect you? (optional)")
    .fill("Same here, two days a month.");
  await match.getByRole("button", { name: "Add my support" }).click();
  await expect(match).toContainText("Thanks, your support was added.");

  await page.goto("/");
  await expect(page.getByRole("listitem", { name: statement })).toContainText(
    "2 supporters",
  );
});
