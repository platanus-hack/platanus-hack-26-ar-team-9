import feeds from '../feeds.json' with { type: 'json' };
import { parseFeed } from '../src/rss/parse.js';
import type { Feed } from '../src/types.js';

const results = await Promise.allSettled(
  feeds.map((f) => parseFeed(f as Feed))
);

for (const [i, result] of results.entries()) {
  const feed = feeds[i]!;
  if (result.status === 'fulfilled') {
    const articles = result.value;
    const latest = articles[0]?.title ?? '—';
    console.log(`✅ ${feed.name.padEnd(15)} ${articles.length} artículos | ${latest.slice(0, 60)}`);
  } else {
    console.log(`❌ ${feed.name.padEnd(15)} ERROR: ${result.reason}`);
  }
}
