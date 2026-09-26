import { getCollection } from 'astro:content';

export async function GET() {
  const changelog = await getCollection('changelog');

  const searchIndex = [
    ...changelog.map(entry => ({
      title: `${entry.data.version}: ${entry.data.title}`,
      description: 'Product update and changelog entry.',
      slug: '/changelog',
      type: 'Changelog'
    }))
  ];

  return new Response(JSON.stringify(searchIndex), {
    headers: { 'Content-Type': 'application/json' }
  });
}
