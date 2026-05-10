/**
 * Cliente de Supabase. Solo se inicializa si hay env vars completas.
 *
 * Para usarlo:
 *   export NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
 *   export NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-public-key>
 *   export NEXT_PUBLIC_DATA_SOURCE=supabase
 *
 * En Vercel, esas tres viven en Project Settings → Environment Variables.
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase no está configurado. Definí NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  cached = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  return cached;
}
