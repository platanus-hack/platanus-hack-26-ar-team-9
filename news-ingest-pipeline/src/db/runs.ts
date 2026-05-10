import { supabase } from './client.js';

export type RunId = number;

export async function startRun(): Promise<RunId> {
  const { data, error } = await supabase
    .from('ingest_runs')
    .insert({})
    .select('id')
    .single();
  if (error) throw new Error(`startRun failed: ${error.message}`);
  return data.id as RunId;
}

export async function finishRun(
  id: RunId,
  stats: { feedsProcessed: number; articlesFound: number; articlesNew: number; articlesFailed: number }
): Promise<void> {
  const { error } = await supabase
    .from('ingest_runs')
    .update({
      finished_at: new Date().toISOString(),
      feeds_processed: stats.feedsProcessed,
      articles_found: stats.articlesFound,
      articles_new: stats.articlesNew,
      articles_failed: stats.articlesFailed,
    })
    .eq('id', id);
  if (error) throw new Error(`finishRun failed: ${error.message}`);
}

export async function recordAttempt(
  runId: RunId,
  url: string,
  outcome: 'inserted' | 'duplicate' | 'failed' | 'quality_gate',
  extractor?: string,
  error?: string
): Promise<void> {
  const { error: dbError } = await supabase.from('ingest_attempts').insert({
    run_id: runId,
    url,
    outcome,
    extractor,
    error,
  });
  if (dbError) throw new Error(`recordAttempt failed: ${dbError.message}`);
}
