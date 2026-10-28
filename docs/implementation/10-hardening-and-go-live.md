# Phase 10 — Hardening & Go-Live

**Goal:** make the system safe for real money and real staff: enforce permissions in the database, protect the audit trail, cover all five roles, and deploy to a separate production Supabase project with backups.

**Depends on:** Phases 01–09 passing their exit criteria.

## A. Backend role enforcement (spec: "permissions enforced in the backend")

Currently `is_staff()` grants every role select/insert/update on almost every table. Add a new migration (e.g. `003_role_policies.sql`) that replaces the generic policies with per-role ones. Suggested matrix (confirm with the hotel owner):

| Area | Owner | Manager | Receptionist | Accountant | Housekeeping |
|------|:----:|:------:|:-----------:|:---------:|:-----------:|
| Settings, users | ✔ | ✔ (no users) | – | – | – |
| Rooms/types edit | ✔ | ✔ | status only | – | own HK status |
| Guests, bookings, check-in/out, folio | ✔ | ✔ | ✔ | read | – |
| Record payments | ✔ | ✔ | ✔ | ✔ | – |
| Approve refunds / expenses, void invoice | ✔ | ✔ | – | ✔ (expenses) | – |
| Invoices create | ✔ | ✔ | ✔ | ✔ | – |
| Expenses, accounts, reports, GST | ✔ | ✔ | – | ✔ | – |
| Housekeeping tasks | ✔ | ✔ | read | – | own tasks |
| Maintenance | ✔ | ✔ | create | – | create |
| Audit log | ✔ | ✔ | – | read | – |

Also:
- Make `audit_logs` **insert-only** (drop its generic update policy; no delete).
- Confirm there is no `delete` policy on any financial table.
- Filter the sidebar in `src/components/AppShell.tsx` by role (UI convenience only — the DB is the enforcement).
- Server actions should check `requireUser()` role for approvals as well as relying on RLS.

**Test:** for each role, attempt each forbidden action directly (not via UI, e.g. with the anon key + that user's JWT in the Supabase client) and confirm it is rejected.

## B. Complete the roles

- Add accountant and housekeeping users to `scripts/seed-users.mjs` (and `.env.local.example`).
- Add a screen (owner only) to create/deactivate staff and change roles, or document the manual Supabase procedure. Role lives in `app_metadata.role`, synced from `profiles` by `sync_profile_role_to_auth`.

## C. Money & data safety review

- All amounts `numeric`, never JS floats for stored values.
- Decide/document: rounding of tax, overpayment handling (`balance_due` clamps at 0), custom payment method → account mapping, P&L basis.
- Verify no hard-delete route exists for payments, invoices, expenses, refunds.
- Concurrency: two users creating overlapping bookings or invoices at once still get correct results (trigger + sequence, not app-side counters).

## D. Production environment

1. Create a **second** Supabase project (prod). Run `001…` and later migrations in order, then the role-policy migration.
2. Seed real users with strong unique passwords; disable/rotate every default `ChangeMe123!`.
3. Deploy the Next.js app (e.g. Vercel). Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in the host's env (server-only for the service key). HTTPS is provided by the host.
4. Upgrade the prod project to **Pro** (automatic daily backups, no idle pause). On Free: no automatic backups and it pauses after a week idle.
5. **Restore drill:** restore a backup into a scratch project and confirm the app runs on it (the spec requires restore capability).
6. Run the Phase 09 end-to-end test once on prod with test records, then void/clean per your policy (financial records are never hard-deleted, so use a clearly labelled test period or start from a fresh project after testing).
7. Add `.env.local` to `.gitignore` check; make sure no service-role key is committed.

## Exit criteria

- [ ] Each role can do only what the matrix allows, proven at DB level.
- [ ] Audit log cannot be edited or deleted by any app user.
- [ ] Prod project live with real users, HTTPS, and backups; restore drill passed.
- [ ] Repo committed per phase; README updated with dev/prod steps.

## After go-live (Phase 2 of the spec — not in this plan)

OTA/channel manager, booking engine, WhatsApp/SMS/email automation, inventory, POS, payroll, mobile app, dynamic pricing, multi-property.
