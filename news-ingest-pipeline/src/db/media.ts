import { supabase } from './client.js';
import { logger } from '../lib/logger.js';
import type { Feed } from '../types.js';

export async function seedMedia(feeds: Feed[]): Promise<void> {
  const rows = feeds.map((f) => ({
    slug: f.slug,
    name: f.name,
    feed_url: f.feedUrl,
    base_url: f.baseUrl,
  }));

  const { error } = await supabase.from('media').upsert(rows, { onConflict: 'slug' });
  if (error) throw new Error(`seedMedia failed: ${error.message}`);
  logger.info({ count: rows.length }, 'media seeded');
}
