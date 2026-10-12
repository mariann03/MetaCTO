import { expect, test } from "@playwright/test";
import accounts from "../data/fixtures/accounts.json";
import users from "../data/fixtures/users.json";

test("switcher lists submitters with their account, and a PM choice persists", async ({
  page,
}) => {
  const submitter = users.find((u) => u.role === "submitter" && u.accountKey);
  const account = accounts.find((a) => a.key === submitter?.accountKey);

  await page.goto("/");
  const switcher = page.getByRole("combobox", { name: "Acting as" });
  await switcher.click();
  await expect(
    page.getByRole("option", { name: `${submitter?.name} · ${account?.name}` }),
  ).toBeVisible();

  const pm = page.getByRole("option", { name: /· PM$/ }).first();
  const pmLabel = (await pm.textContent())?.trim() ?? "";
  await pm.click();
  await expect(switcher).toContainText(pmLabel);

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Acting as" })).toContainText(
    pmLabel,
  );
});
