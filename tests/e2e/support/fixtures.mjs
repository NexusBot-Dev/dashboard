// Standard-Antworten des Fake-Bots. Ein Test kann einzelne Aktionen per /__test/reset überschreiben.
// Werte als Funktion bekommen den Request-Body (z.B. um gespeicherte Werte zurückzugeben).

export const CHANNELS = [
  { id: '200000000000000001', name: 'support' },
  { id: '200000000000000002', name: 'ticket-logs' },
  // Kategorie-/Voice-Namen dürfen bei Discord Sonderzeichen enthalten — muss überall als Text landen
  { id: '200000000000000003', name: 'böse<img src=x onerror="window.__xss=1">' },
];

export const ROLES = [
  { id: '300000000000000001', name: 'Mods', color: 0 },
  { id: '300000000000000002', name: 'Helfer', color: 0 },
];

export const defaultBotData = {
  'guild/info': {
    name: 'Testserver', icon_url: null, member_count: 42, bot_nickname: 'Nexus',
    online: true, hierarchy_ok: true, boost_tier: 1, boost_count: 3,
    uptime_since: '2026-01-01T00:00:00+00:00',
  },
  'guild/channels': { channels: CHANNELS },
  'guild/roles': { roles: ROLES },
  'guild/health-issues': { issues: [] },   // Glocke im Header, auf jeder Seite

  'tickets/list-categories': {
    categories: [
      { id: 1, name: 'Allgemein', role_ids: [ROLES[0].id], roles: [{ id: ROLES[0].id, name: 'Mods' }] },
    ],
    limit_free: 2, limit_premium: 10, premium_active: false,
  },
  'tickets/list-open': {
    tickets: [
      { id: 7, ticket_number: 12, status: 'open', category_name: 'Allgemein', user_tag: 'Max Mustermann', channel_id: '250000000000000001' },
      { id: 8, ticket_number: 13, status: 'pending_closure', category_name: 'Allgemein', user_tag: 'Erika', channel_id: '250000000000000002' },
    ],
  },
  'tickets/get-settings': {
    panel_channel_id: CHANNELS[0].id,
    panel_message_id: '900000000000000001',
    panel_title: '🎫 Support',
    panel_description: 'Hallo **Welt**',
    closure_timeout_hours: 24,
    deletion_delay_hours: 48,
    closure_options: [12, 24, 48],
    deletion_options: [24, 48, 168],
  },

  'tickets/post-panel': (body) => ({ channel_id: body.channel_id ?? CHANNELS[0].id, message_id: '900000000000000002', edited: true }),
  'tickets/import-panel': { channel_id: CHANNELS[0].id, message_id: '900000000000000003', title: 'Alt', description: 'Altes Panel' },
  'tickets/create-category': (body) => ({ id: 2, name: body.name }),
  'tickets/rename-category': (body) => ({ id: body.category_id, name: body.name }),
  'tickets/set-category-roles': (body) => ({ id: body.category_id, roles: [] }),
  'tickets/delete-category': (body) => ({ id: body.category_id }),
  'tickets/set-timeouts': (body) => ({
    closure_timeout_hours: body.closure_timeout_hours ?? 24,
    deletion_delay_hours: body.deletion_delay_hours ?? 48,
  }),

  'guild/emojis': {
    emojis: [{ name: 'blau', id: '400000000000000001', animated: false, url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
  },

  'reaction_roles/list-groups': { groups: [{ id: 5, name: 'Farben' }] },
  'reaction_roles/list-messages': {
    premium_active: false,
    messages: [
      {
        message_id: '700000000000000001', channel_id: CHANNELS[0].id, channel_name: CHANNELS[0].name,
        title: 'Rollen-Auswahl', description: '**Wähle** deine Farbe', display_mode: 'reaction',
        entries: [
          { id: 11, emoji: '🔴', role_id: ROLES[0].id, role_name: 'Mods', mode: 'toggle', group_id: null },
          { id: 12, emoji: '<:blau:400000000000000001>', role_id: ROLES[1].id, role_name: 'Helfer', mode: 'unique', group_id: 5 },
        ],
      },
      {
        message_id: '700000000000000002', channel_id: CHANNELS[1].id, channel_name: null,
        title: 'Pronomen', description: 'Wähle aus dem Menü', display_mode: 'dropdown',
        entries: [],
      },
    ],
  },
  'reaction_roles/create-group': (body) => ({ id: 6, name: body.name }),
  'reaction_roles/create-message': (body) => ({
    message_id: '700000000000000009', channel_id: body.channel_id,
    channel_name: CHANNELS.find((c) => c.id === body.channel_id)?.name, display_mode: body.display_mode,
  }),
  'reaction_roles/add-entry': (body) => ({
    entry_id: 99, role_id: body.role_id, role_name: ROLES.find((r) => r.id === body.role_id)?.name ?? '?',
    emoji: body.emoji, mode: body.mode,
  }),
  'reaction_roles/update-message': (body) => ({
    message_id: body.message_id, title: body.title, description: body.description, message_updated: true, status: 'updated',
  }),
  'reaction_roles/delete-entry': (body) => ({ entry_id: Number(body.entry_id) }),
  'reaction_roles/delete-message': (body) => ({ message_id: body.message_id }),

  'welcome/list': {
    messages: [{ id: 1, message: 'Hallo {user}, willkommen auf **{server}**! <b>Mitglied {membercount}</b>' }],
    limit_free: 2, limit_premium: 5,
  },
  'welcome/add-message': (body) => ({ id: 9, message: body.message }),
  'welcome/edit-message': (body) => ({ id: Number(body.message_id), message: body.message }),
  'welcome/delete-message': (body) => ({ id: Number(body.message_id) }),
  'boosts/list': {
    messages: [{ id: 1, message: 'Danke {user} für den Boost! **{server}** hat <b>{count}</b> Boosts' }],
    limit_free: 2, limit_premium: 5,
  },
  'boosts/add-message': (body) => ({ id: 9, message: body.message }),
  'boosts/edit-message': (body) => ({ id: Number(body.message_id), message: body.message }),
  'boosts/delete-message': (body) => ({ id: Number(body.message_id) }),

  'embeds/list': {
    embeds: [
      { id: 1, name: 'Regeln', title: '📋 Regeln', description: '**Sei nett** zu {user}', channel_id: CHANNELS[0].id, scheduled_at: null },
      { id: 2, name: 'Event', title: '', description: 'Treffen am Freitag', channel_id: CHANNELS[1].id, scheduled_at: '2030-01-02T12:45:00Z' },
    ],
    limit_free: 3, limit_premium: 100, premium_active: false,
  },
  'embeds/add': (body) => ({ id: 9, name: body.name, title: body.title, description: body.description, channel_id: body.channel_id }),
  'embeds/edit': (body) => ({ id: Number(body.embed_id), posts_updated: 0, posts_removed: 0, posts_failed: 0 }),
  'embeds/delete': (body) => ({ id: Number(body.embed_id) }),
  'embeds/post-now': (body) => ({ id: Number(body.embed_id), message_id: '910000000000000001' }),
  'embeds/schedule': (body) => ({ id: Number(body.embed_id), scheduled_at: '2030-03-04T09:30:00Z' }),
  'embeds/unschedule': (body) => ({ id: Number(body.embed_id) }),

  'moderation/list-bans': {
    bans: [
      { user_id: '500000000000000001', username: 'max_mustermann', avatar_url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', reason: 'Spam in #support' },
      { user_id: '500000000000000002', username: 'Erika', avatar_url: null, reason: null },
    ],
  },
  // Restzeit wird beim Rendern aus "until" berechnet — deshalb relativ zur aktuellen Zeit
  'moderation/list-timeouts': () => {
    const inMinutes = (mins) => new Date(Date.now() + mins * 60_000).toISOString();
    return {
      timeouts: [
        { user_id: '600000000000000001', username: 'Tim', avatar_url: null, until: inMinutes(30.5) },
        { user_id: '600000000000000002', username: 'Tina', avatar_url: null, until: inMinutes(150) },
        { user_id: '600000000000000003', username: 'Theo', avatar_url: null, until: inMinutes(3 * 24 * 60 + 60) },
      ],
    };
  },
  'moderation/unban': (body) => ({ user_id: body.user_id }),
  'moderation/remove-timeout': (body) => ({ user_id: body.user_id }),

  'automod/status': {
    spam_enabled: true, mentions_enabled: false, keywords_enabled: true,
    keywords: ['spoiler', 'kaufen'],
    shield_enabled: false, honeypot_channel_id: null, honeypot_timeout_days: 7, honeypot_catches: 0,
  },
  // Wie der Bot: toggle-rule meldet nur die Regel zurück, nicht den neuen Zustand
  'automod/toggle-rule': (body) => ({ rule_key: body.rule_key }),
  'automod/set-keywords': (body) => ({ keywords: body.keywords }),
  'automod/toggle-shield': { shield_enabled: true },
  'automod/create-honeypot': { channel_id: '200000000000000009', channel_name: 'honeypot-falle' },
  'automod/delete-honeypot': { deleted: true },

  'modules/toggle': (body) => ({ modules: { ...body.changes } }),

  settings: (body) => ({ updated_fields: Object.keys(body.fields ?? {}), warnings: [] }),
};
