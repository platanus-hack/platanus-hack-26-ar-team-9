import { z } from 'zod';

export const NormalizedArticleSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(50).max(500),
  body: z.string().min(200),
  author: z.string().nullable(),
  publishedAt: z.string().datetime({ offset: true }),
  language: z.string().default('es'),
  topics: z.array(z.string()).max(8),
});

export type NormalizedArticleAI = z.infer<typeof NormalizedArticleSchema>;
