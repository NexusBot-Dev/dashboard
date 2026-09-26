import type { APIRoute } from 'astro';
import { generateState, getDiscordAuthUrl } from '../../lib/oauth';

export const GET: APIRoute = ({ redirect }) => {
  const state = generateState();
  return redirect(getDiscordAuthUrl(state));
};
