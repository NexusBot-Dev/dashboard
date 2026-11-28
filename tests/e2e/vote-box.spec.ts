import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, guildPath, dbQuery, t } from './support/helpers';
import { USER_ID } from './support/env.mjs';

// Vote-Kasten auf der Server-Übersicht (src/components/VoteBox.astro). Den Vote trägt der Bot ein
// (/webhooks/topgg → topgg_votes); das Dashboard zeigt dann bis zum nächsten möglichen Vote einen Dank.

const PAGE = guildPath('');
const box = (page: Page) => page.locator('[data-vote-box]');
const STORAGE_KEY = 'nexus-vote-box-hidden-until';

async function voteFor(userId: string, minutesFromNow: number) {
  await dbQuery(
    'INSERT INTO topgg_votes (user_id, expires_at) VALUES (?, UTC_TIMESTAMP() + INTERVAL ? MINUTE)',
    [userId, minutesFromNow],
  );
}

test.beforeEach(async ({ context }) => {
  await resetBot();
  await dbQuery('DELETE FROM topgg_votes');
  await login(context);
});

test('ohne Vote: Bitte mit Link auf die Vote-Seite', async ({ page }) => {
  await page.goto(PAGE);
  await expect(box(page)).toBeVisible();
  await expect(box(page)).toHaveAttribute('data-state', 'ask');
  await expect(box(page)).toContainText(t('overview.vote_title'));
  const link = box(page).locator('[data-vote-link]');
  await expect(link).toHaveText(t('overview.vote_button'));
  await expect(link).toHaveAttribute('href', 'https://top.gg/bot/1510643364104765460/vote');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
});

test('mit Vote: Dank statt Bitte, mit Zeit bis zum nächsten Vote', async ({ page }) => {
  await voteFor(USER_ID, 5 * 60 + 30);   // 5 h 30 min → „etwa 6 Std.“
  await page.goto(PAGE);
  await expect(box(page)).toHaveAttribute('data-state', 'thanks');
  await expect(box(page)).toContainText(t('overview.vote_thanks_title'));
  await expect(box(page)).toContainText(t('overview.vote_thanks_text', { hours: 6 }));
  await expect(box(page).locator('[data-vote-link]')).toHaveCount(0);
});

test('abgelaufener Vote oder Vote eines anderen Users: wieder die Bitte', async ({ page }) => {
  await voteFor(USER_ID, -1);
  await voteFor('999999999999999999', 600);
  await page.goto(PAGE);
  await expect(box(page)).toHaveAttribute('data-state', 'ask');
});

test('× blendet für 30 Tage aus, danach kommt der Kasten wieder', async ({ page }) => {
  await page.goto(PAGE);
  await box(page).locator('[data-vote-dismiss]').click();
  await expect(box(page)).toBeHidden();

  const until = Number(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY));
  const days = (until - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThanOrEqual(30);

  await page.reload();
  await expect(box(page)).toBeHidden();

  await page.evaluate((key) => localStorage.setItem(key, String(Date.now() - 1000)), STORAGE_KEY);   // 30 Tage vorbei
  await page.reload();
  await expect(box(page)).toBeVisible();
});

test('auch der Dank lässt sich ausblenden', async ({ page }) => {
  await voteFor(USER_ID, 60);
  await page.goto(PAGE);
  await expect(box(page)).toHaveAttribute('data-state', 'thanks');
  await box(page).locator('[data-vote-dismiss]').click();
  await expect(box(page)).toBeHidden();
});

test('ohne localStorage (z. B. gesperrt): Kasten trotzdem da, × blendet für diese Seite aus', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  await page.goto(PAGE);
  await expect(box(page)).toBeVisible();
  await box(page).locator('[data-vote-dismiss]').click();
  await expect(box(page)).toBeHidden();
});
