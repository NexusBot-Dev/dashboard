# Dashboard

The focused Discord bot for streamers and gaming communities.
Instant alerts, real-time raid defense - no bloat, no filler.

## Features

- Astro 7 with static output
- Tailwind CSS 4 styling
- Responsive SaaS landing page sections
- Pricing, FAQ, testimonials, blog, and changelog pages
- MDX content with reusable callout components
- Dark and light mode with persisted user preference
- Command palette search
- Astro view transitions
- Playwright UI regression tests

## Configuration

Die globalen Seiteneinstellungen liegen in `src/config.ts`:

```ts
export const SITE_TITLE = 'Nexus Bot';
export const SITE_DESCRIPTION = 'The focused Discord bot for streamers and gaming communities. Instant alerts, real-time raid defense - no bloat, no filler.';
export const SITE_URL = 'https://trynexus.de';

export const SOCIAL_LINKS = {
  discord: 'https://discord.gg/YFCrvBb6t3'
};
```

## Credits & Attribution

This project is built upon [Zenix](https://github.com/farrosfr/zenix) by [Farros FR](https://farrosfr.com).

## License

This project is licensed under the [MIT License](LICENSE).
