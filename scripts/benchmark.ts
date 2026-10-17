/** Read-only latency check. Set BASE_URL and optionally FRONTEND_URL to measure deployed apps. */
import { config } from 'dotenv';
import type { ActorGrant } from '../lib/contract';

config({ path: '.env.local', quiet: true });
const base = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const frontend = process.env.FRONTEND_URL?.replace(/\/+$/, '');
const key = process.env.API_KEY;
if (!key) throw new Error('API_KEY is required');

async function main() {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  const entry = await fetch(`${base}/api/demo/entry`, { headers });
  if (!entry.ok) throw new Error(`Demo entry: HTTP ${entry.status}`);
  const grant = await entry.json() as ActorGrant;
  headers['X-Actor'] = grant.actor;
  const home = `/api/homes/${grant.homeId}`;
  const targets = [
    '/api/me', `${home}/dashboard`, `${home}/tasks`, `${home}/booking-options`, `${home}/record`,
  ].map((path) => ({ url: base + path, path: path.replace(grant.homeId!, '{home}'), headers }));
  if (frontend) {
    for (const suffix of ['', '/plan']) {
      targets.push({ url: `${frontend}/homes/${grant.homeId}${suffix}`, path: `frontend/home${suffix}`, headers: { Cookie: `hw_actor=${grant.actor}` } });
    }
  }
  const results = [];
  for (const target of targets) {
    const samples = [];
    let region: string | null = null;
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const res = await fetch(target.url, { headers: target.headers, signal: AbortSignal.timeout(30_000) });
      await res.arrayBuffer();
      if (!res.ok) throw new Error(`${target.path}: HTTP ${res.status}`);
      samples.push(Math.round(performance.now() - started));
      region = res.headers.get('x-vercel-id')?.split('::').slice(0, 2).join('::') ?? null;
    }
    results.push({ path: target.path, medianMs: [...samples].sort((a, b) => a - b)[2], samplesMs: samples, region });
  }
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), base, results }, null, 2));
}

main().catch((err) => { console.error((err as Error).message); process.exit(1); });
