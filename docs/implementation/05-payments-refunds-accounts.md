# Phase 05 — Payments, Refunds & Accounts

**Goal:** money in and out, traceable, with balances and account ledgers updating automatically ("enter once").

**Depends on:** Phase 04.

## Scope

- Payment methods: cash, UPI, bank transfer, credit card, debit card (configurable)
- Advance, partial and final payments; multiple payments per booking; reference number; receipt
- Trigger-driven updates: booking `amount_paid` / `balance_due` and the matching Cash/UPI/Bank/Card account
- Refund workflow: request → approve, original payment never deleted, accounts and balance reversed
- Accounts: `accounts` + `account_transactions` ledger; outstanding balances list

## Prerequisite

Run `supabase/migrations/004_payments.sql` in the SQL Editor (after 001–003).

## Decisions made in this phase

- **Payment methods are a table** (`payment_methods`), each mapped to the account it pays into, with an optional "needs reference" flag. This fixes the old name-matching bug where "Credit Card" silently landed in the Cash account. Owner/manager manage them in Settings. Seeded: Cash, UPI, Bank Transfer, Credit Card, Debit Card.
- **Recording a payment** (`record_payment`, one transaction): amount must be above zero and not more than the balance due (no hidden overpayment); non-cash methods need a transaction reference; receiving a payment on an enquiry/hold booking confirms it.
- **Receipts:** every payment gets a number (RC-000001…), a detail page and a printable receipt (`/print/payments/[id]`).
- **Refunds** (`request_refund`): reason required, capped at what is left on that payment (earlier refunds count), pay-out method chosen, approval per the setting. `decide_refund` approves or rejects and is owner/manager only, enforced in the database.
- **Void payment** (`void_payment`, owner/manager): for entry mistakes only; reverses the account entry and booking balance, keeps the payment on record; refused if the payment has refunds.
- **Accounts page:** net receipts this month = payments minus refunds and voids; outstanding list covers hold/confirmed/checked-in/checked-out; ledger filterable per account.
- `hotel_settings.payment_methods` (old JSON list) is no longer used.

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~479–650: `accounts` (seeded), `account_transactions`, `apply_account_txn`, `payments`, `payment_allocations`, `refunds`, `after_payment_insert`, `after_refund_approved` |
| Payments | `src/app/(app)/payments/page.tsx`, `payments/new/page.tsx`, `payments/actions.ts` (`recordPayment`, `createRefund`, `approveRefund`) |
| Accounts | `src/app/(app)/accounts/page.tsx` |

## How to test (spec: "Booking to Accounts" and "Refund")

1. Booking total ₹10,000. Record ₹3,000 UPI advance → booking paid 3,000 / balance 7,000, **UPI account** +3,000, payment appears in `/payments` linked to booking, guest, user, timestamp. Booking can now be `confirmed`.
2. Record ₹2,000 cash + ₹5,000 card → balance 0; Cash and Card accounts each increase correctly.
3. Refund ₹1,000 against the UPI payment with reason → pending; approve as manager/owner → original payment still present, refund row linked, booking paid/balance and UPI account updated, audit log written.
4. Try refund > amount paid → rejected.
5. `/accounts` shows correct per-account balances and outstanding balances by booking.
6. Void/reversal check: there is no UI or RLS path to hard-delete a payment.

## Exit criteria

- [ ] Every payment is traceable to booking, guest, method, user, time.
- [ ] Balance and the correct account update from a single entry.
- [ ] Refund approval flow works; originals untouched; audit entry created.

## Known gaps / to verify

- `balance_due` still clamps at 0 in the database, but new payments cannot exceed it, and the booking page shows "paid above total" if a later discount causes an overpayment.
- Refund approval and voiding are owner/manager-only in the database; recording payments and requesting refunds are open to all staff until Phase 10.
- `payment_allocations` (payment → invoice) is not used yet; it is wired up in Phase 06.
