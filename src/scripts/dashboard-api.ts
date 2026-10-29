// Gemeinsame Browser-Helfer für die Dashboard-Seiten.
// Wird von den Seiten-Skripten importiert (normale <script>-Tags, von Astro gebündelt) —
// ersetzt die Kopien von postJson/callModuleAction in den einzelnen Seiten.

/** Fehlertexte, die jede Seite aus ihren Übersetzungen mitgibt */
export interface ApiMessages {
  errorGeneric: string;
  errorServerTemplate: string;        // enthält "{status}"
  unexpectedResponseTemplate: string; // enthält "{status}"
}

async function postJson<T>(url: string, body: unknown, messages: ApiMessages): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: { ok?: boolean; error?: string; data?: T };
  try {
    data = await res.json();
  } catch {
    throw new Error(messages.unexpectedResponseTemplate.replace('{status}', String(res.status)));
  }
  if (!res.ok || !data.ok) {
    throw new Error(
      data.error
        ? `${messages.errorGeneric}: ${data.error}`
        : messages.errorServerTemplate.replace('{status}', String(res.status))
    );
  }
  return data.data as T;
}

export function createDashboardApi(guildId: string, messages: ApiMessages) {
  return {
    // trailingSlash: 'always' — Slash am Ende nicht vergessen, sonst wird POST zu GET umgeleitet
    callModuleAction<T = any>(module: string, action: string, body: Record<string, unknown> = {}) {
      return postJson<T>(`/api/server/${guildId}/module/${module}/${action}/`, body, messages);
    },
    saveSettings<T = any>(fields: Record<string, unknown>) {
      return postJson<T>(`/api/server/${guildId}/settings/`, fields, messages);
    },
  };
}

export type DashboardApi = ReturnType<typeof createDashboardApi>;

/** Liest die Konfiguration, die eine Seite per data-config (JSON) an ihr Wurzelelement hängt */
export function readPageConfig<T>(root: HTMLElement): T {
  return JSON.parse(root.dataset.config ?? '{}') as T;
}

/** Element per ID holen, mit passendem Typ (null, wenn es auf der aktuellen Seite fehlt) */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}
