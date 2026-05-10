import { chromium, type Browser } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { config } from '../config.js';
import type { ArticleRef } from '../types.js';
import type { ArticleExtractor, ExtractionResult } from './types.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) browser = await chromium.launch({ headless: true });
  return browser;
}

export async function closePlaywrightBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export class PlaywrightExtractor implements ArticleExtractor {
  name = 'playwright';

  canHandle(_ref: ArticleRef): boolean {
    return true;
  }

  async extract(ref: ArticleRef): Promise<ExtractionResult> {
    const b = await getBrowser();
    const page = await b.newPage();
    try {
      await page.goto(ref.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.ARTICLE_FETCH_TIMEOUT_MS,
      });
      const html = await page.content();
      const dom = new JSDOM(html, { url: ref.url });
      const article = new Readability(dom.window.document).parse();
      if (!article) throw new Error(`Readability returned null for ${ref.url}`);

      const bodyText = (article.textContent ?? '').trim();
      return {
        source: 'playwright',
        bodyText,
        textLength: bodyText.length,
        title: article.title ?? undefined,
        byline: article.byline ?? undefined,
      };
    } finally {
      await page.close();
    }
  }
}
