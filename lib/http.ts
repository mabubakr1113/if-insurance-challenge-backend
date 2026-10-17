import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { resolveActor, type Actor } from './auth';
import { env } from './env';
import { ApiError } from './errors';

export { ApiError, forbidden, invalidState, notFound } from './errors';

export type Params = Record<string, string>;

export interface RouteContext<A, B, Q> {
  req: NextRequest;
  params: Params;
  actor: Actor | null;
  access: A;
  body: B;
  query: Q;
}

interface RouteOptions<A, B, Q> {
  /** 'none': API key only, X-Actor ignored. 'required' (default): a valid actor must be sent. */
  actor?: 'none' | 'required';
  /** Loads the resource and checks the permission code (7.3) and the closed-home rule. */
  access?: (actor: Actor | null, params: Params, req: NextRequest) => Promise<A>;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
}

function keyMatches(header: string | null): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const given = createHash('sha256').update(header.slice(7)).digest();
  const expected = createHash('sha256').update(env().API_KEY).digest();
  return timingSafeEqual(given, expected);
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(400, 'invalid_request', 'The request is not valid', result.error.issues);
  return result.data;
}

async function readJson(req: NextRequest): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'invalid_request', 'The body must be valid JSON');
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    const error: Record<string, unknown> = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return NextResponse.json({ error }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: { code: 'internal', message: 'Something went wrong' } }, { status: 500 });
}

/**
 * Wraps a route handler: API key → actor → access (permission, closed home) → validation → handler → JSON.
 * Throw `ApiError` anywhere to return an error response.
 */
export function route<A = undefined, B = undefined, Q = undefined>(
  opts: RouteOptions<A, B, Q>,
  handler: (ctx: RouteContext<A, B, Q>) => Promise<unknown>,
) {
  return async (req: NextRequest, context: { params: Promise<Params> }): Promise<Response> => {
    const started = Date.now();
    let status = 500;
    let actorKind = '-';
    try {
      if (!keyMatches(req.headers.get('authorization'))) {
        throw new ApiError(401, 'unauthorized', 'A valid API key is required');
      }
      const params = await context.params;
      let actor: Actor | null = null;
      if (opts.actor !== 'none') {
        actor = await resolveActor(req.headers.get('x-actor'));
        if (!actor) throw new ApiError(401, 'actor_required', 'Say who is acting in the X-Actor header');
        actorKind = actor.kind;
      }
      const access = (opts.access ? await opts.access(actor, params, req) : undefined) as A;
      const query = (opts.query ? parse(opts.query, Object.fromEntries(req.nextUrl.searchParams)) : undefined) as Q;
      const body = (opts.body ? parse(opts.body, await readJson(req)) : undefined) as B;
      const result = await handler({ req, params, actor, access, body, query });
      const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
      status = res.status;
      return res;
    } catch (err) {
      const res = errorResponse(err);
      status = res.status;
      return res;
    } finally {
      console.log(`${req.method} ${req.nextUrl.pathname} ${status} ${Date.now() - started}ms actor=${actorKind}`);
    }
  };
}

/* ---------------- shared zod pieces (13) ---------------- */

export const zName = z.string().trim().min(1).max(80);
export const zNote = z.string().trim().max(2000);
export const zComment = z.string().trim().min(1).max(1000);
export const zIsoDate = z.iso.datetime({ offset: true });
export const zYmd = z.iso.date();
export const zUuid = z.uuid();
export const zTemp = z.number().min(-30).max(40);
export const zOptionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
export const zNullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));
