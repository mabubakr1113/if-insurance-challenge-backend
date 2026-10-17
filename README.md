# If Insurance Challenge — Backend

Backend (API, data and integrations) for our JunctionX Turku prototype for the If challenge "If Insurance Could Do More". Companion repo: `if-insurance-challenge-frontend`.

## The challenge

How can insurance become useful and relevant during important life events, and give people a reason to choose and stay with If?

Build a prototype of a product, service, experience or concept that supports people through a meaningful life event (moving home, buying a car, getting married, other major changes) and shows why they would choose, use and stay with If.

This is not a "build another insurance app" challenge. The hard part is finding a real human need where an insurer can add meaningful value without making insurance the centre of the experience. The solution could:

- Prevent something from going wrong
- Simplify a difficult life change
- Guide people towards better decisions
- Offer something else that creates value for customers and, in turn, for If

It must also have a credible business case for If: retention, acquisition, risk prevention, fewer claims, efficiency or new value creation.

## Judging criteria

1. **Customer value and relevance:** a real, clearly defined human need tied to a meaningful life event.
2. **Business value for If:** a credible mechanism through which If benefits.
3. **Feasibility and scalability:** the technology, data, partners and capabilities could work in practice.
4. **Innovation and experience:** challenges the traditional role of insurance, beyond a generic app or incremental improvement.

## Resources

- Public insurance terms and conditions from If and other insurers
- If's insurances, guides and product information: [if.fi](https://www.if.fi)
- Open data such as weather and forecasting data
- Public APIs, statistics and datasets

No customer-specific or confidential insurance data is required.

## Running locally

The API runs on http://localhost:3001 and needs a Supabase database and storage. Either create a Supabase project, or run Supabase locally in Docker:

```bash
# in any folder outside this repo
npx supabase init --yes
npx supabase start -x gotrue,realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
npx supabase status          # API URL → SUPABASE_URL, secret key → SUPABASE_SECRET_KEY, DB URL → SUPABASE_DB_URL
```

Then, in this repo:

```bash
npm install
cp .env.example .env.local   # fill in the Supabase values and a random API_KEY (32+ characters)
npm run db:migrate           # applies supabase/migrations
npm run db:seed              # resets and seeds the demo data, prints the invitation link
npm run dev                  # http://localhost:3001
npm run smoke                # end-to-end check against the running API
```

The frontend uses the same `API_KEY` as its `BACKEND_API_KEY`. `npm run db:seed` and the frontend's "Reset all demo data" both put the demo back to its starting state.

Supabase is the default data store for the shared participant demo. No Supabase Auth signup or login is needed: the frontend's `/demo/start` uses `GET /api/demo/entry` to select the existing example-home coordinator. The endpoint still requires the server-to-server API key and does not create accounts or reset data. Tasks, visits, bookings, photos and role permissions continue through the backend as usual.

For an explicitly temporary local demo only, `DATA_STORE=memory` enables the optional in-memory store. It resets on a server restart. Missing Supabase settings do not silently switch the shared demo to memory.

## Deploying to Vercel

1. Create a Supabase project and configure its `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in `.env.local`. With the CLI, no database password is needed:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --linked
   npm run db:seed
   ```

   The CLI tracks hosted migrations in `supabase_migrations`. The local `npm run db:migrate` script uses its own `_migrations` table; use one migration runner consistently for each database. `db:seed` resets the demo data, so run it only against the dedicated demo project.
2. `vercel link --yes`, then add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `API_KEY` and `APP_TIMEZONE` with `vercel env add <NAME> production`.
3. `vercel deploy --prod`. Functions run in `dub1` (Dublin), near the hosted Supabase database in `eu-west-1`. The frontend uses the same region to avoid server-to-server requests crossing the Atlantic.

## Measuring latency

`npm run benchmark` makes five read-only requests to each of the main API endpoints and reports the samples and median. It does not reset the demo. To measure the deployed apps together:

```bash
BASE_URL=https://YOUR-BACKEND.vercel.app FRONTEND_URL=https://YOUR-FRONTEND.vercel.app npm run benchmark
```

`/api/me` resolves membership and its home in one database query and reads independent information concurrently. Dashboard and record builders reuse data already loaded in the request. Permissions and application data are still checked afresh on every request.
