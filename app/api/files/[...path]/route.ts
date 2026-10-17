import { NextResponse } from 'next/server';
import { store } from '@/lib/memory-db';
import { usesMemoryStore } from '@/lib/supabase';

/** Serves photos from the in-memory store, standing in for Supabase signed URLs. Paths are random UUIDs. */
export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const file = usesMemoryStore() ? store.files.get(path.join('/')) : undefined;
  if (!file) return NextResponse.json({ error: { code: 'not_found', message: 'File not found' } }, { status: 404 });
  return new Response(new Uint8Array(file.body), {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=3600',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
