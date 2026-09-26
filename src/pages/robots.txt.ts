import type { APIRoute } from 'astro';
import { SITE_URL } from '../config';

export const GET: APIRoute = () => {
  const sitemapURL = new URL('/sitemap.xml', SITE_URL);

  const robotsTxt = `User-agent: *
Allow: /$
Disallow: /

Sitemap: ${sitemapURL.href}
`;

  return new Response(robotsTxt, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};
