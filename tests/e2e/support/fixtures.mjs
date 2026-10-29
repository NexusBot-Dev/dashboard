// Standard-Antworten des Fake-Bots. Ein Test kann einzelne Aktionen per /__test/reset überschreiben.
// Werte als Funktion bekommen den Request-Body (z.B. um gespeicherte Werte zurückzugeben).

export const CHANNELS = [
  { id: '200000000000000001', name: 'support' },
  { id: '200000000000000002', name: 'ticket-logs' },
];

export const ROLES = [
  { id: '300000000000000001', name: 'Mods', color: 0 },
  { id: '300000000000000002', name: 'Helfer', color: 0 },
];

export const defaultBotData = {
  'guild/info': {
    name: 'Testserver', icon_url: null, member_count: 42, bot_nickname: 'Nexus',
    online: true, hierarchy_ok: true, boost_tier: 0, boost_count: 0,
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

  settings: (body) => ({ updated_fields: Object.keys(body.fields ?? {}), warnings: [] }),
};
