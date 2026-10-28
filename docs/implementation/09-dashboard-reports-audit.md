# Phase 09 — Dashboard, Reports & Audit

**Goal:** management visibility. With every earlier phase working, this phase is almost entirely read-only and is where the spec's "reports update automatically" is proven.

**Depends on:** Phases 03–08.

## Scope

- Dashboard: today's check-ins/check-outs, occupancy and available rooms, today's bookings/revenue/payments/expenses, pending guest payments, cash/bank/UPI/card summary, quick actions
- Reports: daily/monthly bookings, occupancy, revenue, payment-method summary, expenses, outstanding balances, P&L, GST summary, booking source, cancellations and refunds, room-wise and room-type performance, **ADR** and **RevPAR**
- Audit log viewer (who, what, when)
- Export (Excel via `exceljs`, PDF via `jspdf`) where provided

## Prerequisite

Run `supabase/migrations/008_reports.sql` in the SQL Editor (after 001–007).

## Decisions made in this phase

- **One source for every report figure:** the database function `hotel_report(from, to)` returns everything as JSON. The Reports page and the Excel export both use it, so they cannot disagree.
- **Definitions** (shown on the page): room nights sold = confirmed + checked-in + checked-out stays inside the range; room revenue = rate × nights less the discount pro-rated by nights (no extra bed, folio or GST); occupancy = nights sold ÷ (active rooms × days); ADR = room revenue ÷ nights sold; RevPAR = room revenue ÷ (active rooms × days). Active rooms are today's count for the whole range; hotel timezone (IST) throughout.
- **Reports page:** presets (today, 7 days, this month, last month), occupancy/ADR/RevPAR, income/expenses/profit, rooms-sold-per-day chart, room-type and room-wise performance, payments by method (received, refunded, net), expenses by category, GST summary with credit notes netted, bookings by source, cancellations/no-shows, outstanding balances. **Download Excel** exports all of it (one sheet per table).
- **Dashboard rewritten:** it used the UTC date, counted voided payments and matched payment methods by lowercase name (broken since Phase 05). Now: arrivals/departures with lists and dues, in-house guests, occupancy with cleaning and out-of-service counts, bookings made today, room revenue, payments received (net of refunds shown), expenses, account balances, and a "needs attention" list (guest dues, rooms to clean, open maintenance, approvals).
- **Audit log:** filters (area, action, staff, dates), 50 per page, IST times, readable details, links to the record. It is **append-only for app users**: the update policy was removed here (Phase 10 still locks down who can insert).

## Files

| Area | Path |
|------|------|
| Pages | `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/reports/page.tsx`, `src/app/(app)/audit/page.tsx` |
| DB | `audit_logs` table and `write_audit` function (`001_initial_schema.sql` ~820–847); `writeAudit` in `src/lib/auth.ts` |

## How to test — full end-to-end (all six spec acceptance tests)

Run the whole workflow once with a fresh dataset and check the dashboard and reports after each step:

1. Booking → advance payment → Accounts + booking balance updated → dashboard "payments received" moves.
2. Check-in → charges → GST invoice → GST summary report shows the correct CGST/SGST.
3. Second stay → Non-GST invoice → GST summary does **not** include it.
4. Checkout → room dirty → HK task → cleaned → available; occupancy figures change accordingly.
5. Expense → P&L moves; refund → refunds report and accounts move.
6. Verify ADR = room revenue ÷ rooms sold and RevPAR = room revenue ÷ rooms available by hand for a small period.
7. `/audit` lists every action above with actor and timestamp.
8. Filters/date ranges work; a month with no data shows zeros, not errors.

## Exit criteria

- [ ] All six spec acceptance tests pass end to end.
- [ ] Dashboard/report figures match hand calculations, including ADR/RevPAR.
- [ ] Audit log shows every financial and status action.

## Known gaps / to verify

- All spec reports are present (see above).
- Ranges are limited to one year per report. Indexes on audit log and bookings exist; revisit if the report gets slow.
- Any staff user can still insert audit rows with any actor (Phase 10 closes this by writing audit entries only through the database).
