import RSSParser from 'rss-parser';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { Feed, ArticleRef } from '../types.js';

const parser = new RSSParser({
  headers: { 'User-Agent': config.USER_AGENT },
  timeout: config.ARTICLE_FETCH_TIMEOUT_MS,
});

export async function parseFeed(feed: Feed): Promise<ArticleRef[]> {
  const raw = await parser.parseURL(feed.feedUrl);
  const items = raw.items.slice(0, config.MAX_ARTICLES_PER_FEED);

  const refs: ArticleRef[] = [];
  for (const item of items) {
    const url = item.link ?? item.guid;
    if (!url) {
      logger.warn({ feed: feed.slug }, 'RSS item missing url, skipping');
      continue;
    }
    refs.push({
      url,
      guid: item.guid ?? url,
      title: item.title ?? '(sin título)',
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      author: item.creator ?? item.author ?? null,
      summary: item.contentSnippet ?? item.content ?? null,
      categories: (item.categories ?? []).map((c) => {
        if (typeof c === 'string') return c;
        try { return JSON.stringify(c); } catch { return ''; }
      }).filter(Boolean),
      feedSlug: feed.slug,
      rawRss: item,
    });
  }

  return refs;
}
