import { expect, test } from "@playwright/test";
import { asPm, asSubmitter, submit } from "./helpers";

test("a PM generates a decision brief whose claims link to their sources", async ({
  page,
}) => {
  const need = `brief ${Date.now()}`;
  await asSubmitter(page, 12);
  await submit(page, need);

  await asPm(page);
  await page.goto("/");
  await page.getByRole("link", { name: `Customers need ${need}.` }).click();
  const brief = page.getByRole("region", { name: "Decision brief" });
  await expect(brief).toContainText("No brief yet.");
  await brief.getByRole("button", { name: "Generate brief" }).click();
  await expect(brief.getByRole("status")).toContainText("Gathering");

  // The agent runs after the response; reload until its brief lands.
  await expect(async () => {
    await page.reload();
    await expect(brief).toContainText("Fake brief statement.", {
      timeout: 1000,
    });
  }).toPass();
  for (const section of [
    "Who is asking",
    "Solution options",
    "Open questions and risks",
  ])
    await expect(brief.getByRole("heading", { name: section })).toBeVisible();
  // A quote cites its request, which links to it on the page.
  const source = brief.getByRole("link", { name: /^request:\d+$/ }).first();
  const id = (await source.textContent())?.split(":")[1];
  await expect(source).toHaveAttribute("href", `#request-${id}`);
  await expect(page.locator(`#request-${id}`)).toContainText(need);
});
