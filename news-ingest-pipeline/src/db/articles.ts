import { supabase } from './client.js';
import type { NormalizedArticle } from '../types.js';

export async function findExistingUrls(urls: string[]): Promise<Set<string>> {
  const CHUNK = 50;
  const existing = new Set<string>();
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const { data, error } = await supabase.from('articles').select('url').in('url', chunk);
    if (error) throw new Error(`findExistingUrls failed: ${error.message}`);
    for (const r of data ?? []) existing.add((r as { url: string }).url);
  }
  return existing;
}

export async function insertArticle(a: NormalizedArticle): Promise<{ inserted: boolean }> {
  const row = {
    url: a.url,
    guid: a.guid,
    medium_slug: a.mediumSlug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    author: a.author,
    published_at: a.publishedAt,
    language: a.language,
    topics: a.topics,
    extraction_path: a.extractionSource,
  };

  const { error, data } = await supabase
    .from('articles')
    .upsert(row, { onConflict: 'url', ignoreDuplicates: true })
    .select('url');

  if (error) throw new Error(`insertArticle failed: ${error.message}`);
  return { inserted: (data?.length ?? 0) > 0 };
}
