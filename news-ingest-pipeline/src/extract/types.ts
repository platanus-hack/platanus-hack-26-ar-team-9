import type { ArticleRef, NormalizedArticle } from '../types.js';

export interface ExtractionResult {
  source: 'readability' | 'playwright' | 'rss-only';
  bodyText: string;
  textLength: number;
  title?: string;
  byline?: string;
  preNormalized?: NormalizedArticle;
}

export interface ArticleExtractor {
  name: string;
  canHandle(ref: ArticleRef): boolean;
  extract(ref: ArticleRef): Promise<ExtractionResult>;
}
