import { logger } from '../lib/logger.js';
import type { ArticleRef, NormalizedArticle } from '../types.js';
import type { ExtractorChain } from '../extract/chain.js';
import type { ArticleProcessor } from './types.js';
import { normalize } from '../ai/normalizer.js';

export class StandardProcessor implements ArticleProcessor {
  constructor(private readonly chain: ExtractorChain) {}

  async process(ref: ArticleRef): Promise<NormalizedArticle | null> {
    const extraction = await this.chain.extract(ref);

    if (!extraction) {
      logger.debug({ url: ref.url }, 'all extractors failed quality gate');
      return null;
    }

    if (extraction.preNormalized) return extraction.preNormalized;

    const result = await normalize(ref, extraction);
    if (!result) logger.warn({ url: ref.url }, 'normalizer returned null');
    return result;
  }
}
