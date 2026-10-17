import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

export const PHOTO_BUCKET = 'home-photos';

let client: SupabaseClient | null = null;

/** Admin client using the secret key. It bypasses RLS, so it must never leave the server. */
export function db(): SupabaseClient {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = env();
    client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
