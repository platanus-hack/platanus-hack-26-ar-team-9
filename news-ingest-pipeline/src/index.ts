import feeds from '../feeds.json' with { type: 'json' };
import { logger } from './lib/logger.js';
import { perDomainLimit } from './lib/concurrency.js';
import { parseFeed } from './rss/parse.js';
import { isEntertainment } from './rss/filter.js';
import { seedMedia } from './db/media.js';
import { findExistingUrls, insertArticle } from './db/articles.js';
import { startRun, finishRun, recordAttempt } from './db/runs.js';
import { ExtractorChain } from './extract/chain.js';
import { ReadabilityExtractor } from './extract/readability.js';
import { PlaywrightExtractor, closePlaywrightBrowser } from './extract/playwright.js';
import { AgenticMcpExtractor } from './extract/agentic-mcp.js';
import { StandardProcessor } from './processor/standard.js';
import type { Feed, ArticleRef } from './types.js';

const chain = new ExtractorChain([
  new ReadabilityExtractor(),
  new PlaywrightExtractor(),
  new AgenticMcpExtractor(),
]);
const processor = new StandardProcessor(chain);

const stats = {
  feedsProcessed: 0,
  articlesFound: 0,
  articlesEntertainment: 0,
  articlesDuplicate: 0,
  articlesNew: 0,
  articlesFailed: 0,
};

async function processMediumRefs(runId: number, refs: ArticleRef[]): Promise<void> {
  await Promise.all(
    refs.map((ref) => {
      const limit = perDomainLimit(ref.url);
      return limit(async () => {
        try {
          const article = await processor.process(ref);
          if (!article) {
            stats.articlesFailed++;
            await recordAttempt(runId, ref.url, 'quality_gate');
            return;
          }
          const { inserted } = await insertArticle(article);
          if (inserted) {
            stats.articlesNew++;
            await recordAttempt(runId, ref.url, 'inserted', article.extractionSource);
            logger.info({ medium: ref.feedSlug, title: article.title.slice(0, 60) }, 'inserted');
          } else {
            await recordAttempt(runId, ref.url, 'duplicate');
          }
        } catch (err) {
          stats.articlesFailed++;
          logger.error({ url: ref.url, err }, 'article processing failed');
          await recordAttempt(runId, ref.url, 'failed', undefined, String(err)).catch(() => {});
        }
      });
    })
  );
}

logger.info('scraper starting');
await seedMedia(feeds as Feed[]);
const runId = await startRun();

// Parse all feeds in parallel
const allRefs = (
  await Promise.allSettled(
    (feeds as Feed[]).map(async (feed) => {
      try {
        const refs = await parseFeed(feed);
        stats.feedsProcessed++;
        logger.info({ feed: feed.slug, count: refs.length }, 'feed parsed');
        return refs;
      } catch (err) {
        logger.error({ feed: feed.slug, err }, 'feed parse failed');
        return [];
      }
    })
  )
).flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

stats.articlesFound = allRefs.length;
logger.info({ total: allRefs.length }, 'articles found across all feeds');

const editorialRefs = allRefs.filter((r) => !isEntertainment(r));
stats.articlesEntertainment = allRefs.length - editorialRefs.length;
logger.info(
  { kept: editorialRefs.length, dropped: stats.articlesEntertainment },
  'entertainment filter applied'
);

const existingUrls = await findExistingUrls(editorialRefs.map((r) => r.url));
const newRefs = editorialRefs.filter((r) => !existingUrls.has(r.url));
stats.articlesDuplicate = editorialRefs.length - newRefs.length;
logger.info({ new: newRefs.length, skipped: stats.articlesDuplicate }, 'dedup done');

// Group by medium and process each medium concurrently
const byMedium = newRefs.reduce<Map<string, typeof newRefs>>((acc, r) => {
  const list = acc.get(r.feedSlug) ?? [];
  list.push(r);
  acc.set(r.feedSlug, list);
  return acc;
}, new Map());
await Promise.all(
  [...byMedium.entries()].map(([slug, refs]) => {
    logger.info({ medium: slug, count: refs.length }, 'processing medium');
    return processMediumRefs(runId, refs);
  })
);

await finishRun(runId, stats);
await closePlaywrightBrowser();

logger.info(stats, 'scraper done');
