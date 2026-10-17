import { z } from 'zod';

/** Used when API_KEY isn't set, so the demo runs with no setup. The frontend falls back to the same value. */
export const DEMO_API_KEY = 'home-watch-demo-key';

// An empty line like `API_KEY=` in .env counts as not set.
const blank = (v: unknown) => (v === '' ? undefined : v);

const schema = z
  .object({
    /** 'memory' keeps the demo in the server process; 'supabase' needs the two Supabase values. */
    DATA_STORE: z.preprocess(blank, z.enum(['memory', 'supabase']).optional()),
    SUPABASE_URL: z.preprocess(blank, z.url().optional()),
    SUPABASE_SECRET_KEY: z.preprocess(blank, z.string().min(1).optional()),
    API_KEY: z.preprocess(blank, z.string().min(16).default(DEMO_API_KEY)),
    APP_TIMEZONE: z.preprocess(blank, z.string().default('Europe/Helsinki')),
  })
  .transform((e) => ({
    ...e,
    DATA_STORE: e.DATA_STORE ?? (e.SUPABASE_URL && e.SUPABASE_SECRET_KEY ? ('supabase' as const) : ('memory' as const)),
  }))
  .refine((e) => e.DATA_STORE === 'memory' || (e.SUPABASE_URL && e.SUPABASE_SECRET_KEY), {
    path: ['SUPABASE_URL'],
    message: 'DATA_STORE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY',
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
