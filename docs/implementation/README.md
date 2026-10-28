# Hotel Cloud HMS — Implementation Phases

Source of truth: `Hotel_Cloud_Management_System_Development_Specification.pdf` (Phase 1 scope only).
Stack: Next.js 16 (App Router) + Tailwind 4 + Supabase (Auth, Postgres/RLS, Storage).

Each file below is one **shippable, testable phase**. Finish a phase's "Exit criteria" before starting the next. Every phase builds on the previous one and leaves the app in a working state.

| # | Phase | You can now… | Spec acceptance test it unlocks |
|---|-------|--------------|----------------------------------|
| 01 | [Foundation](01-foundation.md) | Log in with roles, edit hotel settings | — |
| 02 | [Rooms & Guests](02-rooms-and-guests.md) | Maintain room inventory and guest records | — |
| 03 | [Bookings & Calendar](03-bookings-and-calendar.md) | Create bookings, see availability, no double-booking | — |
| 04 | [Check-in / Check-out & Folio](04-checkin-checkout-folio.md) | Run a full stay and compute the final bill | Checkout → Housekeeping (first half) |
| 05 | [Payments, Refunds & Accounts](05-payments-refunds-accounts.md) | Take advance/partial/final payments and refund | Booking → Accounts, Refund |
| 06 | [Invoicing (GST / Non-GST)](06-invoicing.md) | Issue, print, void and credit-note invoices | GST Invoice, Non-GST Invoice |
| 07 | [Expenses & P&L](07-expenses-and-pnl.md) | Record expenses, see Profit & Loss | Expense → P&L |
| 08 | [Housekeeping & Maintenance](08-housekeeping-and-maintenance.md) | Clean rooms after checkout, log repairs | Checkout → Housekeeping (full) |
| 09 | [Dashboard, Reports & Audit](09-dashboard-reports-audit.md) | See today's numbers, run reports, review audit trail | All 6, end to end |
| 10 | [Hardening & Go-Live](10-hardening-and-go-live.md) | Enforce roles in the DB, back up, deploy to prod | — |

## Current state of the repo (as of this plan)

Phases 01–09 already exist as **uncommitted code** (only the `Initial commit from Create Next App` is committed). Each phase file lists the files that belong to it and what still needs verifying. Treat the work as **verify → fix → commit per phase**, not build-from-scratch.

Known cross-cutting problems found while writing these docs (all handled in [Phase 10](10-hardening-and-go-live.md) unless a phase says otherwise):

1. **Role enforcement is not real yet.** RLS policies give every staff user the same select/insert/update on almost every table (`is_staff()`); only `hotel_settings` and `profiles` check roles. The sidebar (`AppShell.tsx`) shows every link to every role. The spec requires backend enforcement.
2. **Audit log is editable.** `audit_logs` gets the generic staff `update` policy, so its rows can be altered.
3. **Only 3 of 5 roles are seeded.** Accountant and Housekeeping exist in the enum and types but `scripts/seed-users.mjs` doesn't create them.
4. **One monolithic migration.** `supabase/migrations/001_initial_schema.sql` (~950 lines) creates everything at once. Phases are therefore separated by *feature testing*, not by migration. Optional: split it (see Phase 01 "Optional cleanup").

## Working method per phase

1. Read the phase file; skim the listed files.
2. Run the "How to test" steps against your **dev** Supabase project.
3. Fix anything failing; keep fixes inside that phase's files where possible.
4. Tick the exit criteria, commit (`phase-NN: …`), then move on.

## Supabase environments

- **dev**: a free Supabase project used for all phases 01–09. Fake data only.
- **prod**: a second, separate project created in Phase 10. Same SQL files, real users, Pro plan (backups).
- Switching is only a matter of the three keys in `.env.local` (dev) vs. the hosting provider's env vars (prod). Never reuse the service-role key outside the server.
