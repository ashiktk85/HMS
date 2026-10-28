# Phase 01 — Foundation (Auth, Roles, Settings)

**Goal:** a deployed-able shell where staff can log in, see a role-aware layout, and configure the hotel. Nothing else works yet, but everything later stands on this.

**Depends on:** nothing.

## Scope

- Supabase project + env wiring
- Login / logout, session refresh, route protection
- Profiles + roles (`owner`, `manager`, `receptionist`, `accountant`, `housekeeping`)
- Hotel settings (name, address, GSTIN, invoice prefixes, tax rates, currency)
- App shell (sidebar, header), health endpoint

## Files

| Area | Path |
|------|------|
| DB | `supabase/migrations/001_initial_schema.sql` lines ~1–181 (enums, `set_updated_at`, `current_role`, `has_role`, `is_staff`, `profiles`, `handle_new_user`, `sync_profile_role_to_auth`, `hotel_settings`) |
| Env | `.env.local.example` |
| Seed | `scripts/seed-users.mjs`, `npm run seed` |
| Supabase clients | `src/lib/supabase/{client,server,middleware}.ts` |
| Session/role helpers | `src/lib/auth.ts` (`getSessionProfile`, `requireUser`, `writeAudit`) |
| Route guard | `src/middleware.ts` |
| Pages | `src/app/(auth)/login/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/settings/{page,actions}.ts(x)`, `src/app/auth/signout/route.ts`, `src/app/api/health/route.ts`, `src/app/page.tsx` |
| UI | `src/components/AppShell.tsx`, `src/components/ui.tsx`, `src/app/globals.css` (Tailwind) |

## How to test

1. Create a free Supabase project (this is **dev**). SQL Editor → run `001_initial_schema.sql`, then `002_storage_buckets.sql`.
2. `cp .env.local.example .env.local`, fill URL / anon key / service-role key.
3. `npm install && npm run seed && npm run dev`.
4. Visit `/dashboard` logged out → redirected to `/login`.
5. Log in as `owner@hotel.local` → lands on `/dashboard`; sidebar shows hotel name from settings.
6. `/settings`: change hotel name, GSTIN, invoice prefixes → save → reload → persisted, sidebar name updated.
7. Log out → redirected to login. Log in as `reception@hotel.local` → try to save settings (should be refused; RLS allows only owner/manager).
8. `GET /api/health` works without login.
9. `npm run build` and `npm run lint` pass.

## Exit criteria

- [ ] Login/logout works for all seeded users; unauthenticated access redirects.
- [ ] Settings persist and reflect in the shell.
- [ ] Non-owner/manager cannot change settings (verified, not just hidden).
- [ ] Build + lint clean.

## Known gaps / to verify

- Seed script creates only owner, manager, receptionist. Adding accountant + housekeeping seeds is done in [Phase 10](10-hardening-and-go-live.md).
- Sidebar shows all links to all roles (Phase 10).
- Default passwords are `ChangeMe123!` — must be changed before any real use.

## Optional cleanup

Split `001_initial_schema.sql` into per-phase migrations (`001_foundation`, `002_rooms_guests`, …) so a fresh database can be brought up phase by phase. Not required for testing since all tables exist from the start.
