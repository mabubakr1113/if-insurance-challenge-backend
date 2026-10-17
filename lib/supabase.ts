import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';
import { memoryClient } from './memory-db';

export const PHOTO_BUCKET = 'home-photos';

let client: SupabaseClient | null = null;

/** True when there's no Supabase: the demo lives in the server process (lib/memory-db). */
export const usesMemoryStore = () => env().DATA_STORE === 'memory';

/** Admin client using the secret key (it bypasses RLS, so it must never leave the server), or the in-memory store. */
export function db(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
    client = usesMemoryStore()
      ? memoryClient()
      : createClient(SUPABASE_URL as string, SUPABASE_SECRET_KEY as string, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
  }
  return client;
}
