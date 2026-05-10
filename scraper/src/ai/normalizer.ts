import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { NormalizedArticleSchema } from './schema.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import type { ArticleRef, NormalizedArticle } from '../types.js';
import type { ExtractionResult } from '../extract/types.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function normalize(
  ref: ArticleRef,
  extraction: ExtractionResult
): Promise<NormalizedArticle | null> {
  const userPrompt = buildUserPrompt(ref, extraction);
  let lastError = '';

  for (let attempt = 1; attempt <= 3; attempt++) {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: attempt === 1 ? userPrompt : `${userPrompt}\n\nError en intento anterior: ${lastError}\nCorregí el JSON y devolvé solo el JSON válido.` },
    ];

    try {
      const response = await client.messages.create({
        model: config.LLM_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages,
      });

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(clean);
      } catch (e) {
        lastError = `JSON inválido: ${e}`;
        logger.debug({ attempt, url: ref.url }, 'JSON parse failed, retrying');
        continue;
      }

      const result = NormalizedArticleSchema.safeParse(parsed);
      if (!result.success) {
        lastError = result.error.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
        logger.debug({ attempt, url: ref.url, lastError }, 'zod validation failed, retrying');
        continue;
      }

      return {
        url: ref.url,
        guid: ref.guid,
        mediumSlug: ref.feedSlug,
        extractionSource: extraction.source,
        ...result.data,
      };
    } catch (err: unknown) {
      if (err instanceof Anthropic.RateLimitError) {
        const delay = Math.min(1000 * 2 ** attempt, 16000);
        logger.warn({ attempt, delay }, 'rate limited, backing off');
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      logger.error({ err, url: ref.url }, 'normalizer unexpected error');
      return null;
    }
  }

  logger.warn({ url: ref.url, lastError }, 'normalize failed after 3 attempts');
  return null;
}
