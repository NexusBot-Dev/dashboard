import { test, expect } from '@playwright/test';
import { login, resetBot, guildPath, t } from './support/helpers';
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
    const hrefs = await page.locator('footer a:not([data-twemoji-credit] a)').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual([
      `https://trynexus.de/${siteLang}/imprint/`,
      `https://trynexus.de/${siteLang}/privacy/`,
      `https://trynexus.de/${siteLang}/terms/`,
    ]);
  });
}

// Twemoji steht unter CC BY 4.0: Name und Lizenz müssen genannt und verlinkt sein
test('Namensnennung für die Emoji-Grafiken mit Links zu Twemoji und Lizenz', async ({ page }) => {
  await page.goto(guildPath('settings/'));
  const credit = page.locator('footer [data-twemoji-credit]');
  await expect(credit).toBeVisible();
  await expect(credit).toHaveText(`${t('footer.emoji_credit')}: Twemoji (CC BY 4.0)`, { useInnerText: true });
  await expect(credit.getByRole('link', { name: 'Twemoji' })).toHaveAttribute('href', 'https://github.com/twitter/twemoji');
  await expect(credit.getByRole('link', { name: 'CC BY 4.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/4.0/');
});
