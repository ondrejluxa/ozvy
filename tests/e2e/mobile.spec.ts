import { expect, test } from "@playwright/test";

/** Spec §30: core screens work on a 390 px phone without horizontal scrolling. */

const PAGES = ["/admin", "/admin/companies", "/admin/campaigns"];

for (const path of PAGES) {
  test(`no horizontal scroll at 390 px: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("note")).toContainText("Ukázková data");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("company and client view fit a phone", async ({ page }) => {
  await page.goto("/admin");
  await page.getByRole("link", { name: "Otevřít Autoservis Dvořák" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Autoservis Dvořák");
  for (const tab of ["Zákazníci", "Segmenty", "Kampaně"]) {
    await page.getByRole("link", { name: tab, exact: true }).first().click();
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    ).toBeLessThanOrEqual(0);
  }
  await page.getByRole("button", { name: "Otevřít účet klienta" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("Vrácené tržby tento měsíc")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(0);
});
