import type { APIRoute } from 'astro';
import { clearSession } from '../../lib/session';

export const GET: APIRoute = async ({ cookies, redirect }) => {
  await clearSession(cookies);
  return redirect('/');
};