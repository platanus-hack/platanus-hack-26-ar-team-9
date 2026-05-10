import type { ArticleRef, NormalizedArticle } from '../types.js';

export interface ArticleProcessor {
  process(ref: ArticleRef): Promise<NormalizedArticle | null>;
}
