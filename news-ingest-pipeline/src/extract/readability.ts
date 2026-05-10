import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { config } from '../config.js';
import type { ArticleRef } from '../types.js';
import type { ArticleExtractor, ExtractionResult } from './types.js';

export class ReadabilityExtractor implements ArticleExtractor {
  name = 'readability';

  canHandle(_ref: ArticleRef): boolean {
    return true;
  }

  async extract(ref: ArticleRef): Promise<ExtractionResult> {
    const res = await fetch(ref.url, {
      headers: { 'User-Agent': config.USER_AGENT },
      signal: AbortSignal.timeout(config.ARTICLE_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status} for ${ref.url}`);
    const html = await res.text();

    const dom = new JSDOM(html, { url: ref.url });
    const article = new Readability(dom.window.document).parse();
    if (!article) throw new Error(`Readability returned null for ${ref.url}`);

    const bodyText = (article.textContent ?? '').trim();
    return {
      source: 'readability',
      bodyText,
      textLength: bodyText.length,
      title: article.title ?? undefined,
      byline: article.byline ?? undefined,
    };
  }
}
