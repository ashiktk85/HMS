# Hotel Cloud HMS

Single-hotel cloud management system (Phase 1) built with **Next.js** + **Supabase Free**.

Enter data once — bookings, payments, invoices, accounts, housekeeping and reports stay connected.

## Setup

### 1. Supabase project (Free)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run in order:
   - [`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
   - [`supabase/migrations/002_storage_buckets.sql`](supabase/migrations/002_storage_buckets.sql)
3. Copy **Project URL**, **anon key**, and **service_role key** from Project Settings → API.

### 2. App env

```bash
cp .env.local.example .env.local
```

Fill in the Supabase values.

### 3. Seed 3 users

```bash
node --env-file=.env.local scripts/seed-users.mjs
```

Default accounts (change passwords immediately):

| Role | Email | Password |
|------|-------|----------|
| Owner | owner@hotel.local | ChangeMe123! |
| Manager | manager@hotel.local | ChangeMe123! |
| Reception | reception@hotel.local | ChangeMe123! |

### 4. Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Modules (implementation slices)

1. Login, roles, settings  
2. Rooms + guests  
3. Bookings + calendar  
4. Check-in / check-out + folio  
5. Payments + refunds  
6. GST / Non-GST invoices + print  
7. Expenses + accounts + P&L  
8. Housekeeping + maintenance  
9. Dashboard + reports + audit  

## Free tier reminders

- **No automatic backups** on Free — export SQL periodically from the dashboard until you move to Pro (~$25/mo).
- Projects **pause after 1 week of inactivity** on Free — daily hotel use avoids this.
- File storage quota is **1 GB** (guest IDs + expense receipts).

## Stack

- Next.js App Router + TypeScript + Tailwind
- Supabase Auth, Postgres (RLS), Storage
- Roles via `app_metadata.role` (not editable `user_metadata`)
