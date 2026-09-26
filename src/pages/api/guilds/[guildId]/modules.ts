import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';

export const POST: APIRoute = async ({ params, request }) => {
  const { guildId } = params;
  const body = await request.json();
  const token = readFileSync(process.env.INTERNAL_API_TOKEN_FILE!, 'utf-8').trim();

  // TODO: hier später Session-Check + can_manage(user, guildId) einfügen,
  // sobald OAuth steht — aktuell noch ungesichert!

  const res = await fetch(`http://nexus:8081/api/guilds/${guildId}/modules/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': token,
    },
    body: JSON.stringify(body),
  });

  return new Response(await res.text(), { status: res.status });
};
