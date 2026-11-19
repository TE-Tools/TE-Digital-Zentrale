import { expect, type Page, test } from '@playwright/test';

/** Lokale Anmeldung (nur auf localhost aktiv) über die Oberfläche. */
async function anmelden(page: Page) {
  await page.goto('/');
  const lokal = page.getByRole('button', { name: /Lokal anmelden/ });
  const dashboard = page.getByText('Unternehmensstatus', { exact: false }).first();
  // Erst warten, bis die App entschieden hat (Anmeldeseite oder bereits angemeldet)
  await expect(lokal.or(dashboard)).toBeVisible();
  if (await lokal.isVisible()) await lokal.click();
  await expect(dashboard).toBeVisible();
}

const istHandy = (page: Page) => (page.viewportSize()?.width ?? 1000) < 600;

test.describe('TE-Digital Zentrale', () => {
  test('Dashboard zeigt Status, Mitarbeiter und Projekte', async ({ page }) => {
    await anmelden(page);
    await expect(page.getByRole('heading', { name: /Guten (Morgen|Tag|Abend)|Gute Nacht/ })).toBeVisible();
    await expect(page.getByText('Zentrale Projektleitung').first()).toBeVisible();
    await expect(page.locator('.pj-karte', { hasText: 'Orchester Orga' })).toBeVisible();
    if (istHandy(page)) {
      await expect(page.getByRole('navigation', { name: 'Schnellnavigation' })).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Hauptnavigation' })).toBeHidden();
    } else {
      await expect(page.getByRole('complementary', { name: 'Hauptnavigation' })).toBeVisible();
    }
  });

  test('Kompletter Auftrag: anlegen → Paket → Antwort → Freigabe → weiter', async ({ page, browserName }, info) => {
    const titel = `E2E-Auftrag ${info.project.name} ${Date.now()}`;
    await anmelden(page);

    // Auftrag erteilen (am Handy über das „+“ der unteren Navigation)
    if (istHandy(page)) await page.getByRole('navigation', { name: 'Schnellnavigation' }).getByRole('link', { name: 'Neuer Auftrag' }).click();
    else await page.goto('/aufgaben/neu');
    await page.getByLabel('Titel').fill(titel);
    await page.locator('textarea[name="beschreibung"]').fill('Drei Textvarianten für die Startseite.');
    await page.locator('select[name="projekt_slug"]').selectOption('familienplaner');
    await page.locator('select[name="zustaendig_id"]').selectOption('marketing');
    await page.locator('textarea[name="ziel"]').fill('Mehr Registrierungen');
    await page.getByRole('button', { name: 'Auftrag erteilen' }).click();

    await expect(page).toHaveURL(/\/aufgaben\/TD-\d{4}$/);
    await expect(page.locator('pre.paket')).toContainText('# Auftrag TD-');
    await expect(page.locator('pre.paket')).toContainText('Mehr Registrierungen');
    await expect(page.locator('pre.paket')).toContainText('Rolle – Marketing & Vertrieb');

    // Starten, Antwort aus dem KI-Tool einfügen
    await page.getByRole('button', { name: 'Starten' }).click();
    await expect(page.locator('.detail-kopf')).toContainText('In Bearbeitung');
    await page.getByLabel('Antwort').fill(
      'ERGEBNIS:\nVariante A, B und C.\nOFFENE FRAGEN: keine\nFREIGABEANTRÄGE:\nVeröffentlichung von Variante A\nZWISCHENSTAND:\nAlle Varianten fertig.',
    );
    await page.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(page.locator('.detail-kopf')).toContainText('Freigabe erforderlich');
    await expect(page.locator('.zeitleiste')).toContainText('Alle Varianten fertig.');

    // Freigabe erteilen (lokal ersetzt der Entwicklungszugang die Passkey-Bestätigung)
    await page.goto('/freigaben');
    const karte = page.locator('article.freigabe', { hasText: titel });
    await expect(karte).toBeVisible();
    await karte.getByRole('button', { name: 'Freigeben' }).click();
    await expect(page.locator('article.freigabe', { hasText: titel })).toHaveCount(0);

    // Aufgabe läuft weiter, Entscheidung steht im Protokoll
    await page.goto('/aufgaben?gruppe=arbeit');
    await page.getByRole('link', { name: new RegExp(titel) }).click();
    await expect(page.locator('.detail-kopf')).toContainText('In Bearbeitung');
    await expect(page.getByText(/Freigegeben: Freigabeantrag zu TD-/).first()).toBeVisible();
    void browserName;
  });

  test('Unternehmenswissen: Liste, Artikel mit Markdown, Versionen', async ({ page }) => {
    await anmelden(page);
    await page.goto('/wissen');
    await page.getByRole('link', { name: /Entscheidungsstufen und Freigaben/ }).click();
    await expect(page.getByRole('heading', { name: 'Stufe 3 – nur mit Freigabe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Version 1' })).toBeVisible();
  });

  test('Tagesbericht erstellen und lesen', async ({ page }) => {
    await anmelden(page);
    await page.goto('/berichte');
    await page.getByRole('button', { name: 'Jetzt erstellen' }).click();
    await expect(page).toHaveURL(/\/berichte\/\d+$/);
    await expect(page.getByRole('heading', { name: 'Überblick' })).toBeVisible();
  });

  test('Kein waagerechtes Scrollen auf den Hauptseiten', async ({ page }) => {
    await anmelden(page);
    for (const pfad of ['/', '/aufgaben', '/projekte', '/projekte/orchester', '/kommunikation', '/freigaben', '/wissen', '/berichte', '/entwicklung', '/benachrichtigungen', '/einstellungen']) {
      await page.goto(pfad);
      await page.waitForLoadState('networkidle');
      const ueberlauf = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(ueberlauf, `${pfad} läuft ${ueberlauf}px über`).toBeLessThanOrEqual(1);
    }
  });

  test('Handy: Mehr-Menü erreicht alle Bereiche', async ({ page }) => {
    test.skip(!istHandy(page), 'nur Handy');
    await anmelden(page);
    await page.getByRole('button', { name: 'Mehr' }).click();
    const blatt = page.getByRole('dialog', { name: 'Alle Bereiche' });
    for (const bereich of ['KI-Mitarbeiter', 'Projekte', 'Entwicklung', 'Kommunikation', 'Unternehmenswissen', 'Berichte', 'Benachrichtigungen', 'Einstellungen & Verwaltung']) {
      await expect(blatt.getByRole('link', { name: bereich })).toBeVisible();
    }
    await blatt.getByRole('link', { name: 'Unternehmenswissen' }).click();
    await expect(page).toHaveURL(/\/wissen$/);
  });

  test('Offline: App öffnet aus dem Service Worker mit letztem Stand', async ({ page, context }) => {
    await anmelden(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload(); // jetzt vom Service Worker kontrolliert, Dashboard-Stand gespeichert
    await expect(page.getByText('Unternehmensstatus', { exact: false }).first()).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
    await context.setOffline(false);
  });
});
