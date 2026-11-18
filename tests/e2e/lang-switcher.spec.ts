import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, guildPath } from './support/helpers';

// Sprachumschalter oben rechts (src/components/TopHeader.astro): Flaggen als SVG aus public/flags,
// im Button nur das Kürzel, im Menü der Name der Sprache in der Sprache selbst.

const button = (page: Page) => page.locator('#lang-switcher-btn');
const menu = (page: Page) => page.locator('#lang-dropdown');
const option = (page: Page, lang: string) => menu(page).locator(`[data-lang-option="${lang}"]`);

/** Bild ist wirklich geladen (Datei vorhanden, gültiges SVG) */
const loaded = (img: ReturnType<Page['locator']>) => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

test('Button: Flagge und Kürzel, Menü: Flagge und ausgeschriebene Sprache', async ({ page }) => {
  await page.goto(guildPath(''));
  await expect(button(page)).toHaveText('DE');
  await expect(button(page)).toHaveAttribute('aria-label', 'Sprache: Deutsch');
  await expect(button(page).locator('img')).toHaveAttribute('src', '/flags/de.svg');
  expect(await loaded(button(page).locator('img'))).toBe(true);
  await expect(menu(page)).toBeHidden();

  await button(page).click();
  await expect(menu(page)).toBeVisible();
  const expected = [['de', 'Deutsch', 'de'], ['en', 'English', 'gb'], ['es', 'Español', 'es'], ['pt', 'Português', 'br']];
  await expect(menu(page).locator('[data-lang-option]')).toHaveCount(expected.length);
  for (const [lang, name, flag] of expected) {
    await expect(option(page, lang)).toHaveText(name);
    await expect(option(page, lang)).toHaveAttribute('lang', lang);
    await expect(option(page, lang).locator('img')).toHaveAttribute('src', `/flags/${flag}.svg`);
    await expect.poll(() => loaded(option(page, lang).locator('img'))).toBe(true);
  }
  // keine Emoji-Flaggen mehr (Chrome unter Windows zeigt die nur als Buchstaben)
  expect(await page.locator('#lang-switcher-container').innerText()).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
});

test('Wechsel auf Englisch: Button zeigt EN mit britischer Flagge', async ({ page }) => {
  await page.goto(guildPath(''));
  await button(page).click();
  await option(page, 'en').click();
  await expect(button(page)).toHaveText('EN');
  await expect(button(page).locator('img')).toHaveAttribute('src', '/flags/gb.svg');
  await expect(button(page)).toHaveAttribute('aria-label', 'Language: English');
  await button(page).click();
  await expect(option(page, 'de')).toHaveText('Deutsch');   // bleibt in der eigenen Sprache
});
