import { expect, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

test("a PM merges a duplicate Problem into another, keeping its requests and supporters", async ({
  page,
}) => {
  const stamp = Date.now();
  const [target, source] = [`merge target ${stamp}`, `merge source ${stamp}`];
  await asSubmitter(page, 9);
  await submit(page, target);
  await asSubmitter(page, 10);
  await submit(page, source);

  await asPm(page);
  await page.goto("/");
  await page.getByRole("link", { name: `Customers need ${source}.` }).click();
  const curate = page.getByRole("region", { name: "Curate" });
  await curate
    .getByRole("combobox", { name: "Merge this problem into" })
    .click();
  await page.getByRole("option", { name: `Customers need ${target}.` }).click();
  await curate.getByRole("button", { name: "Merge" }).click();

  const merged = page.getByRole("article");
  await expect(merged.getByRole("heading", { level: 1 })).toHaveText(
    `Customers need ${target}.`,
  );
  await expect(merged.getByText("2 supporters")).toBeVisible();
  for (const title of [target, source])
    await expect(
      merged.getByRole("listitem").filter({ hasText: title }),
    ).toHaveCount(1);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: `Customers need ${source}.` }),
  ).toHaveCount(0);
});
