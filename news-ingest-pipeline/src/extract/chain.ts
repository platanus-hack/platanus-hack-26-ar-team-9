import { logger } from '../lib/logger.js';
import type { ArticleRef } from '../types.js';
import type { ArticleExtractor, ExtractionResult } from './types.js';

export function defaultQualityGate(result: ExtractionResult): boolean {
  const words = result.bodyText.trim().split(/\s+/);
  if (result.textLength < 400) return false;
  if (words.length < 80) return false;
  const avgWordLen = result.bodyText.replace(/\s+/g, '').length / words.length;
  if (avgWordLen < 3 || avgWordLen > 12) return false;
  return true;
}

export class ExtractorChain {
  constructor(
    private readonly extractors: ArticleExtractor[],
    private readonly qualityGate: (r: ExtractionResult) => boolean = defaultQualityGate
  ) {}

  async extract(ref: ArticleRef): Promise<ExtractionResult | null> {
    for (const extractor of this.extractors) {
      if (!extractor.canHandle(ref)) continue;
      try {
        const result = await extractor.extract(ref);
        if (this.qualityGate(result)) return result;
        logger.debug({ extractor: extractor.name, url: ref.url }, 'quality gate failed');
      } catch (err) {
        logger.warn({ extractor: extractor.name, url: ref.url, err }, 'extractor error');
      }
    }
    return null;
  }
}
