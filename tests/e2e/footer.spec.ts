import { test, expect } from '@playwright/test';
import { login, resetBot, guildPath } from './support/helpers';
import { APP_URL } from './support/env.mjs';

// Footer-Links führen auf die Homepage — die gibt es nur auf Deutsch und Englisch.

test.beforeEach(async ({ context }) => {
  await resetBot();
  await login(context);
});

for (const [lang, siteLang] of [['de', 'de'], ['en', 'en'], ['es', 'en'], ['pt', 'en']]) {
  test(`Dashboard auf ${lang}: Rechtliches auf trynexus.de/${siteLang}/`, async ({ page, context }) => {
    await context.addCookies([{ name: 'nexus_lang', value: lang, url: APP_URL }]);
    await page.goto(guildPath('settings/'));
    const hrefs = await page.locator('footer a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual([
      `https://trynexus.de/${siteLang}/imprint/`,
      `https://trynexus.de/${siteLang}/privacy/`,
      `https://trynexus.de/${siteLang}/terms/`,
    ]);
  });
}
