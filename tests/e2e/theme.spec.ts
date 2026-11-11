import { test, expect } from '@playwright/test';
import { login, resetBot, guildPath } from './support/helpers';

// Das Dashboard hat nur ein dunkles Design — unabhängig von der Einstellung des Systems.

for (const scheme of ['light', 'dark'] as const) {
  test(`immer dunkel, auch wenn das System „${scheme}“ einstellt`, async ({ page, context }) => {
    await resetBot();
    await login(context);
    await page.emulateMedia({ colorScheme: scheme });
    // Ein alter Wert aus dem früheren Umschalter darf nichts mehr bewirken
    await context.addInitScript(() => localStorage.setItem('theme', 'light'));
    for (const path of ['/', guildPath('settings/')]) {
      await page.goto(path);
      const look = await page.evaluate(() => ({
        body: getComputedStyle(document.body).backgroundColor,
        scheme: getComputedStyle(document.documentElement).colorScheme,   // auch Auswahllisten & Datumsfelder dunkel
      }));
      expect(look, path).toEqual({ body: 'rgb(9, 9, 11)', scheme: 'dark' });
    }
  });
}
