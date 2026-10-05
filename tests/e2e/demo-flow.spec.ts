import { expect, test, type Page } from "@playwright/test";

/**
 * The 5-minute sales demo, end to end, on the deterministic demo seed:
 * admin → Autoservis Dvořák → opportunity → builder → AI template → preview
 * → simulated send → booked/completed → client dashboard.
 */

const money = (czk: string) => new RegExp(czk.replace(/ /g, "\\s"));

async function resetDemo(page: Page) {
  await page.goto("/admin");
  await page
    .getByRole("complementary", { name: "Průvodce ukázkou" })
    .getByRole("button", { name: "Resetovat demo" })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: "Resetovat demo" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.waitForLoadState("networkidle");
}

test("full presentation flow", async ({ page }) => {
  await resetDemo(page);

  // 1. Admin overview, clearly labelled as demo data.
  await expect(page.getByRole("note")).toContainText("Ukázková data");
  await expect(page).toHaveTitle(/^\[DEMO\]/);
  await expect(page.getByRole("heading", { name: /Vyžaduje pozornost/ })).toBeVisible();

  // 2. Open the main shop from the guide.
  await page.getByRole("link", { name: "Otevřít Autoservis Dvořák" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Autoservis Dvořák s.r.o.");
  await expect(page.getByText(money("52 300 Kč")).first()).toBeVisible();
  await expect(page.getByText("10,5×")).toBeVisible();
  await expect(page.getByText("Doporučeno", { exact: true })).toBeVisible();

  // 3. Opportunity → campaign builder with the segment preselected.
  await page.getByRole("link", { name: "Vytvořit kampaň z příležitosti" }).click();
  await expect(page.getByRole("heading", { name: "Bez návštěvy 12+ měsíců" })).toBeVisible();
  await page.getByRole("button", { name: "Pokračovat" }).click();

  // 4. AI template, diacritics toggle cuts segments.
  await page.getByRole("button", { name: "Vygenerovat zprávu pomocí AI" }).click();
  const editor = page.getByLabel("Šablona zprávy");
  await expect(editor).toHaveValue(/\{\{odhlaseni\}\}/);
  await expect(page.getByText("3 SMS segmenty")).toBeVisible();
  await page.getByLabel("Odstranit diakritiku").check();
  await expect(page.getByText("2 SMS segmenty")).toBeVisible();
  await expect(page.getByText(/Odhlasit: example\.cz\/o\//)).toBeVisible();

  // 5. Schedule + review.
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.getByText("Kontrola před odesláním")).toBeVisible();
  await page.getByRole("button", { name: "Vytvořit a simulovat odeslání" }).click();

  // 6. Simulated send finishes and the campaign becomes active.
  await expect(page.getByRole("heading", { name: "Simulace odeslání" })).toBeVisible();
  await expect(page.getByText("Aktivní", { exact: true }).first()).toBeVisible({ timeout: 45_000 });
  await expect(page).not.toHaveURL(/sending=1/);

  // 7. A customer calls back: booked, then completed with the job value.
  const firstRow = page.locator("tbody tr").first();
  await firstRow.getByRole("button", { name: "Objednal se" }).click();
  await expect(firstRow.getByText("Objednal se")).toBeVisible();
  await firstRow.getByRole("button", { name: "Dokončeno" }).click();
  await page.getByLabel("Částka zakázky (Kč)").fill("6800");
  await page.getByRole("dialog").getByRole("button", { name: "Uložit" }).click();
  await expect(firstRow.getByText(money("6 800 Kč"))).toBeVisible();

  // 8. The owner's read-only view includes the new job.
  await page
    .getByRole("region", { name: /Notifications/ })
    .getByRole("button", { name: "Zobrazit klientský pohled" })
    .click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText("pouze čtení")).toBeVisible();
  await expect(page.getByText(money("59 100 Kč")).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Vytvořit kampaň" })).toHaveCount(0);

  await resetDemo(page);
});
