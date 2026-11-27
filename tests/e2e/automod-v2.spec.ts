import { test, expect, type Page } from '@playwright/test';
import { login, resetBot, waitForBotCall, botCalls, collectDialogs, guildPath, t } from './support/helpers';
import { AUTOMOD_V2, CHANNELS, ROLES, defaultBotData } from './support/fixtures.mjs';

// AutoMod 2.0: aufklappbare Karten mit Einstellungen (src/components/automod/RuleCard.astro), Übernehmen
// fremder Regeln, Shield im eigenen Tab. Ohne v2 (Testphase, älterer Bot) bleibt es bei drei Karten.

const PAGE = guildPath('automod/');
const withV2 = (rules: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  'automod/status': { data: { ...AUTOMOD_V2, ...extra, rules: { ...AUTOMOD_V2.rules, ...rules } } },
});

// Nutzdaten ohne Nutzer, Server und Sprache — die prüft waitForBotCall bei jedem Aufruf selbst
const payload = ({ acting_user_id: _u, guild_id: _g, lang: _l, ...rest }: Record<string, unknown>) => rest;

const card = (page: Page, kind: string) => page.locator(`[data-rule-card="${kind}"]`);
const expand = (page: Page, kind: string) => card(page, kind).locator('[data-rule-expand]').click();
const form = (page: Page, kind: string, which: 'settings' | 'content') => card(page, kind).locator(`[data-rule-form="${which}"]`);
const field = (page: Page, kind: string, name: string) => card(page, kind).locator(`[data-field="${name}"]`);
const save = (page: Page, kind: string, which: 'settings' | 'content') => form(page, kind, which).locator('[data-rule-save]');

test.beforeEach(async ({ context }) => {
  await resetBot(withV2());
  await login(context);
});

test.describe('ohne AutoMod 2.0', () => {
  test('Testphase oder älterer Bot: nur Anti-Spam, Mention-Spam, Wortfilter — ohne Einstellungen', async ({ page }) => {
    await resetBot();   // Standard-Status ohne v2
    await page.goto(PAGE);
    await expect(page.locator('[data-rule-card]')).toHaveCount(3);
    await expect(page.locator('[data-rule-expand]')).toHaveCount(0);
    await expect(card(page, 'mentions')).toContainText(t('automod.mention_spam_desc_suffix'));
    await expect(page.locator('#keywords-display')).toBeVisible();

    await resetBot({ 'automod/status': { data: { ...defaultBotData['automod/status'], v2: false, rules: AUTOMOD_V2.rules, rule_limits: AUTOMOD_V2.rule_limits } } });
    await page.reload();
    await expect(page.locator('[data-rule-card]')).toHaveCount(3);
    await expect(page.locator('[data-rule-expand]')).toHaveCount(0);
  });
});

test.describe('Karten', () => {
  test('sechs Regeln mit Zusammenfassung, Einstellungen erst nach dem Aufklappen', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('[data-rule-card]')).toHaveCount(6);
    await expect(card(page, 'keywords').locator('[data-rule-summary]')).toHaveText(
      `${t('automod.summary_words', { count: 2 })} · ${t('automod.summary_timeout', { duration: t('automod.duration_minutes', { n: 10 }) })}`,
    );
    await expect(card(page, 'spam').locator('[data-rule-summary]')).toHaveText(t('automod.summary_roles_one'));   // Einzahl
    await expect(card(page, 'links').locator('[data-rule-summary]')).toHaveText(
      [t('automod.summary_invites'), t('automod.summary_domains_one'), t('automod.summary_partners_one')].join(' · '),
    );
    await expect(card(page, 'mentions')).toContainText(`5 ${t('automod.mention_spam_desc_suffix_v2')}`);

    const panel = page.locator('#rule-panel-spam');
    await expect(panel).toBeHidden();
    await expand(page, 'spam');
    await expect(panel).toBeVisible();
    await expect(card(page, 'spam').locator('[data-rule-expand]')).toHaveAttribute('aria-expanded', 'true');
    await expand(page, 'spam');
    await expect(panel).toBeHidden();
  });

  test('noch nicht angelegte Regel: Hinweis statt Einstellungen; Einschalten lädt neu und zeigt sie', async ({ page }) => {
    await page.goto(PAGE);
    await expect(card(page, 'presets').locator('[data-rule-setup-hint]')).toHaveText(t('automod.setup_hint'));
    await expect(card(page, 'presets').locator('[data-rule-expand]')).toHaveCount(0);

    await resetBot({
      ...withV2({ presets: { enabled: true, custom_message: null, exempt_role_ids: [], exempt_channel_ids: [], timeout_minutes: 0, presets: ['slurs'], allow_list: [] } }),
      'automod/toggle-rule': { data: { rule_key: 'presets', enabled: true } },
    });
    await card(page, 'presets').locator('[data-automod-toggle]').click();
    await expect(card(page, 'presets').locator('[data-rule-expand]')).toBeVisible();   // nach dem Neuladen
    expect((await botCalls('automod/toggle-rule'))[0].body).toMatchObject({ rule_key: 'presets' });
  });

  test('Shield liegt im eigenen Tab', async ({ page }) => {
    await page.goto(PAGE);
    await expect(page.locator('#shield-toggle')).toBeHidden();
    await page.getByRole('tab', { name: t('automod.tab_shield') }).click();
    await expect(page.locator('#shield-toggle')).toBeVisible();
    await expect(page.locator('#tab-panel-automod')).toBeHidden();
  });
});

test.describe('Einstellungen', () => {
  test('Hinweis, Rollen, Channels, Timeout: Speichern erst nach Änderung, Payload und Zusammenfassung', async ({ page }) => {
    await page.goto(PAGE);
    await expand(page, 'keywords');
    await expect(save(page, 'keywords', 'settings')).toBeDisabled();

    await field(page, 'keywords', 'custom_message').fill('  Bitte keine Werbung.  ');
    await field(page, 'keywords', 'exempt_role_ids').getByLabel(`@${ROLES[1].name}`).check();
    await field(page, 'keywords', 'exempt_channel_ids').getByLabel(`#${CHANNELS[0].name}`).check();
    await field(page, 'keywords', 'timeout_minutes').selectOption('60');
    await save(page, 'keywords', 'settings').click();

    expect(payload(await waitForBotCall('automod/rule-settings'))).toEqual({
      rule_key: 'keywords', custom_message: 'Bitte keine Werbung.', exempt_role_ids: [ROLES[1].id],
      exempt_channel_ids: [CHANNELS[0].id], timeout_minutes: 60,
    });
    await expect(field(page, 'keywords', 'custom_message')).toHaveValue('Bitte keine Werbung.');
    await expect(save(page, 'keywords', 'settings')).toBeDisabled();
    await expect(card(page, 'keywords').locator('[data-rule-summary]')).toContainText(t('automod.summary_notice'));
    await expect(card(page, 'keywords').locator('[data-rule-summary]')).toContainText(t('automod.duration_hours', { n: 1 }));
  });

  test('Mention-Limit und Raid-Schutz', async ({ page }) => {
    await page.goto(PAGE);
    await expand(page, 'mentions');
    await field(page, 'mentions', 'mention_limit').fill('12');
    await field(page, 'mentions', 'raid_protection').check();
    await save(page, 'mentions', 'settings').click();
    expect(payload(await waitForBotCall('automod/rule-settings'))).toEqual({ rule_key: 'mentions', mention_limit: 12, raid_protection: true });
    await expect(card(page, 'mentions').locator('[data-rule-summary]')).toHaveText(
      `${t('automod.summary_limit', { count: 12 })} · ${t('automod.summary_raid')}`,
    );
  });

  test('Timeout nur bei Wortfilter, Mention-Spam und Link-Filter', async ({ page }) => {
    await page.goto(PAGE);
    await expect(field(page, 'spam', 'timeout_minutes')).toHaveCount(0);
    for (const kind of ['keywords', 'mentions', 'links']) await expect(field(page, kind, 'timeout_minutes')).toHaveCount(1);
  });

  test('Zeitangaben in Einzahl und Mehrzahl, ohne „Tag(e)“', async ({ page }) => {
    // 2 Tage hat ein Admin in Discord gesetzt – der Wert bleibt wählbar
    await resetBot(withV2({ keywords: { ...AUTOMOD_V2.rules.keywords, timeout_minutes: 2880 } }));
    await page.goto(PAGE);
    await expand(page, 'keywords');
    const option = (minutes: number) => field(page, 'keywords', 'timeout_minutes').locator(`option[value="${minutes}"]`);
    await expect(option(1440)).toHaveText(t('automod.duration_day_one'));
    await expect(option(2880)).toHaveText(t('automod.duration_days', { n: 2 }));
    await expect(option(10080)).toHaveText(t('automod.duration_week_one'));
    await expect(card(page, 'keywords').locator('[data-rule-summary]')).toContainText(
      t('automod.summary_timeout', { duration: t('automod.duration_days', { n: 2 }) }),
    );
    for (const text of await field(page, 'keywords', 'timeout_minutes').locator('option').allTextContents()) {
      expect(text).not.toMatch(/\(/);
    }
  });

  test('Fehler des Bots: Meldung, Eingabe bleibt, Speichern wieder möglich', async ({ page }) => {
    await resetBot({ ...withV2(), 'automod/rule-settings': { status: 400, error: 'Der Hinweis ist zu lang.' } });
    await page.goto(PAGE);
    const dialogs = collectDialogs(page);
    await expand(page, 'spam');
    await field(page, 'spam', 'custom_message').fill('Hallo');
    await save(page, 'spam', 'settings').click();
    await expect.poll(() => dialogs.join('\n')).toContain('Der Hinweis ist zu lang.');
    await expect(field(page, 'spam', 'custom_message')).toHaveValue('Hallo');
    await expect(save(page, 'spam', 'settings')).toBeEnabled();
  });

  test('in Discord ausgenommener Channel, den das Dashboard nicht kennt, bleibt beim Speichern erhalten', async ({ page }) => {
    const spam = { ...AUTOMOD_V2.rules.spam, exempt_channel_ids: ['999999999999999999'] };
    // Wie der echte Bot: antwortet mit dem tatsächlichen Stand der Regel in Discord
    await resetBot({ ...withV2({ spam }), 'automod/rule-settings': { data: { rule_key: 'spam', ...spam, custom_message: 'x' } } });
    await page.goto(PAGE);
    await expand(page, 'spam');
    await expect(field(page, 'spam', 'exempt_channel_ids').getByLabel('#999999999999999999')).toBeChecked();
    await field(page, 'spam', 'custom_message').fill('x');
    await save(page, 'spam', 'settings').click();
    // Nur das Geänderte geht an den Bot — die unbekannte Ausnahme bleibt in Discord ohnehin unangetastet
    expect(payload(await waitForBotCall('automod/rule-settings'))).toEqual({ rule_key: 'spam', custom_message: 'x' });

    // Ändert man die Channels, ist sie in der Liste dabei
    await field(page, 'spam', 'exempt_channel_ids').getByLabel(`#${CHANNELS[0].name}`).check();
    await save(page, 'spam', 'settings').click();
    expect(payload(await waitForBotCall('automod/rule-settings', 1)).exempt_channel_ids).toEqual(['999999999999999999', CHANNELS[0].id].sort());
  });
});

test.describe('Inhalte', () => {
  test('Wortlisten: Listen wählen und erlaubte Wörter', async ({ page }) => {
    await resetBot(withV2({ presets: { enabled: true, custom_message: null, exempt_role_ids: [], exempt_channel_ids: [], timeout_minutes: 0, presets: ['slurs'], allow_list: [] } }));
    await page.goto(PAGE);
    await expand(page, 'presets');
    await field(page, 'presets', 'presets').getByLabel(t('automod.preset_profanity')).check();
    await field(page, 'presets', 'allow_list').fill('Mist\n\n  Scheibe ');
    await save(page, 'presets', 'content').click();
    expect(payload(await waitForBotCall('automod/rule-content'))).toEqual({
      rule_key: 'presets', presets: ['profanity', 'slurs'], allow_list: ['Mist', 'Scheibe'],
    });
    await expect(field(page, 'presets', 'allow_list')).toHaveValue('mist\nscheibe');   // Stand des Bots
  });

  test('Link-Filter: Einladungen, Support-Server, Partner, Domains und belegte Plätze', async ({ page }) => {
    await page.goto(PAGE);
    await expand(page, 'links');
    await expect(field(page, 'links', 'partner_links')).toHaveValue('discord.gg/partner1');
    await expect(card(page, 'links').locator('[data-links-usage]')).toHaveText(t('automod.allow_list_usage', { count: 4, max: 100 }));

    await field(page, 'links', 'allow_support').uncheck();
    await field(page, 'links', 'partner_links').fill('discord.gg/partner1\nhttps://discord.gg/neu2');
    await field(page, 'links', 'blocked_domains').fill('example.com\nevil.org');
    await save(page, 'links', 'content').click();
    expect(payload(await waitForBotCall('automod/rule-content'))).toEqual({
      rule_key: 'links', allow_support: false,
      partner_links: ['discord.gg/partner1', 'https://discord.gg/neu2'], blocked_domains: ['example.com', 'evil.org'],
    });
    await expect(field(page, 'links', 'partner_links')).toHaveValue('discord.gg/partner1\ndiscord.gg/neu2');
    await expect(card(page, 'links').locator('[data-links-usage]')).toHaveText(t('automod.allow_list_usage', { count: 4, max: 100 }));
  });

  test('Namensfilter: Wörter, nur Rollen als Ausnahme, kein Hinweis und kein Timeout', async ({ page }) => {
    await resetBot(withV2({ names: { enabled: true, custom_message: null, exempt_role_ids: [], exempt_channel_ids: [], timeout_minutes: 0, keywords: [] } }, { foreign_rules: {} }));
    await page.goto(PAGE);
    await expand(page, 'names');
    for (const name of ['custom_message', 'timeout_minutes', 'exempt_channel_ids']) await expect(field(page, 'names', name)).toHaveCount(0);
    await field(page, 'names', 'keywords').fill('Admin\nMOD*');
    await save(page, 'names', 'content').click();
    expect(payload(await waitForBotCall('automod/rule-content'))).toEqual({ rule_key: 'names', keywords: ['Admin', 'MOD*'] });
  });
});

test.describe('Fremde Regel übernehmen', () => {
  test('belegt: Hinweis und Knopf statt Schalter; Rückfrage, dann übernommen', async ({ page }) => {
    await page.goto(PAGE);
    const names = card(page, 'names');
    await expect(names.locator('[data-automod-toggle]')).toHaveCount(0);
    await expect(names.locator('[data-rule-foreign]')).toHaveText(t('automod.foreign_taken', { name: 'Namen vom Admin' }));

    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void (accept ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
    await names.locator('[data-automod-adopt]').click();
    await expect.poll(() => dialogs).toEqual([t('automod.confirm_adopt', { name: 'Namen vom Admin' })]);
    expect(await botCalls('automod/adopt-rule')).toHaveLength(0);   // abgebrochen

    accept = true;
    await resetBot(withV2({ names: { enabled: true, custom_message: null, exempt_role_ids: [], exempt_channel_ids: [], timeout_minutes: 0, keywords: ['a'] } }, { foreign_rules: {} }));
    await names.locator('[data-automod-adopt]').click();
    expect(payload(await waitForBotCall('automod/adopt-rule'))).toEqual({ rule_key: 'names' });
    await expect(names.locator('[data-automod-toggle]')).toBeVisible();   // nach dem Neuladen
  });
});

test.describe('Handy', () => {
  test('aufgeklappte Karte passt auf 360 px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(PAGE);
    await expand(page, 'links');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});
