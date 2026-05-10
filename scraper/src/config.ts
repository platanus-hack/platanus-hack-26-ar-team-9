import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });
dotenvConfig(); // fallback to .env
import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  USER_AGENT: z.string().default('scraper/1.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  MAX_ARTICLES_PER_RUN: z.coerce.number().default(2000),
  MAX_ARTICLES_PER_FEED: z.coerce.number().default(100),
  ARTICLE_FETCH_TIMEOUT_MS: z.coerce.number().default(10000),
  LLM_TIMEOUT_MS: z.coerce.number().default(30000),
  DOMAIN_CONCURRENCY: z.coerce.number().default(2),
  GLOBAL_CONCURRENCY: z.coerce.number().default(10),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = Object.freeze(result.data);
