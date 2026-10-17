import { z } from 'zod';

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  API_KEY: z.string().min(16),
  APP_TIMEZONE: z.string().default('Europe/Helsinki'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Reads and validates the environment once. Throws a clear error naming every missing variable. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}. See .env.example.`);
  }
  cached = parsed.data;
  return cached;
}
