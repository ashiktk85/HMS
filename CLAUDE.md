# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` / `npm run build` / `npm start` — standard Next.js (16.x, React 19; see AGENTS.md — read `node_modules/next/dist/docs/` before using Next APIs).
- `npm run lint` — ESLint (flat config, `eslint-config-next`).
- `npm run seed` — creates the 3 default users (owner/manager/reception) via `scripts/seed-users.mjs`; needs `.env.local` (copy `.env.local.example`) including `SUPABASE_SERVICE_ROLE_KEY`.
- There is no test suite configured. Behaviour was verified with throwaway scripts against the dev Supabase project (create test rows, call the functions as different roles, delete the rows).

## Architecture

Single-hotel management system (Next.js App Router + Supabase Auth/Postgres/Storage). Modules: rooms, guests, bookings/calendar, check-in/out + folio, payments/refunds, GST/non-GST invoices (printable), expenses/accounts/P&L, housekeeping, maintenance, reports, audit.

- **Routing**: `src/app/(auth)/login` is public; everything under `src/app/(app)/*` is wrapped by `(app)/layout.tsx`, which requires a session (redirects to `/login`) and renders `AppShell`. `src/app/print/invoices/[id]` is the print view outside the shell. `src/middleware.ts` delegates to `updateSession` in `src/lib/supabase/middleware.ts` (refreshes the Supabase session cookies, redirects unauthenticated users to `/login`; only `/login` and `/api/health` are public). That file also exports `createServiceClient()` (service-role client — server-only, bypasses RLS).
- **Data access**: pages are server components that query Supabase directly via `src/lib/supabase/server.ts`; mutations are server actions in per-module `actions.ts` files (e.g. `(app)/bookings/actions.ts`) that call `requireUser()`, do the write, `writeAudit(...)` (from `src/lib/auth.ts`), then `revalidatePath`/`redirect`. Actions return `{ error }` objects for validation failures. Shared types live in `src/lib/types.ts`.
- **Roles**: `owner` / `manager` / `receptionist` / `accountant` / `housekeeping` (type in `src/lib/types.ts`; only the first three are seeded). Role comes from `app_metadata.role`, falling back to `profiles.role`; see `getSessionProfile()`. Row-level security still lets every signed-in user read/write most tables; role limits are enforced inside specific database functions (refund/expense approval, voiding, credit notes) and the rest is Phase 10 (`docs/implementation/10-hardening-and-go-live.md`).
- **Business logic lives in Postgres**, not in server actions. Multi-step operations (check-in/out, room change, record payment, refunds, issue invoice, credit note, expenses, housekeeping, maintenance) are `plpgsql` functions called with `supabase.rpc(...)` so they run as one transaction and enforce their own rules and audit entries; triggers handle double-booking, status history, booking totals and the account ledger. Server actions only validate input, call the function, and `revalidatePath`. Don't re-implement these rules in app code; change the migration instead. Reports come from one function, `hotel_report(from, to)`, shared by the page and the Excel export.
- **Migrations** live in `supabase/migrations/001…008` and are applied manually, in order, by pasting each file into the Supabase SQL Editor (no CLI workflow). Each phase doc in `docs/implementation/` names the migration it needs. Never edit an applied migration; add a new numbered one.
- **Conventions**: dates are `YYYY-MM-DD` strings in the hotel timezone (`src/lib/dates.ts`, Asia/Kolkata); money is `numeric(12,2)` and never deleted, only voided/reversed/credited with a reason; forms use `ActionForm` + `SubmitButton` (`src/components/ActionForm.tsx`) so server errors are shown; labelled inputs use `Field` (`src/components/ui.tsx`). Print pages live outside the app shell under `src/app/print/`.
- **Exports**: Excel via `exceljs` in `src/app/(app)/reports/export/route.ts`; invoices, payment receipts and PDFs use the browser print dialog ("Save as PDF"), so `jspdf` is currently unused.
