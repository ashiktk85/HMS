# Phase 07 — Expenses & Profit & Loss

**Goal:** record operating expenses once and see them reflected in accounts and P&L.

**Depends on:** Phase 05 (accounts).

## Scope

- Configurable expense categories (salary, electricity, food, maintenance, supplies…)
- Supplier/payee, amount, payment method, date
- Bill/receipt attachment (private `expense-receipts` bucket)
- Optional approval status; posting creates an account debit
- Income vs expenses and Profit & Loss view

## Prerequisite

Run `supabase/migrations/006_expenses.sql` in the SQL Editor (after 001–005). It also fixes a Phase 06 issue: staff could call the invoice-number function directly and skip numbers.

## Decisions made in this phase

- **The payment method decides the account** (same `payment_methods` table as payments), fixing the old name matching that sent card expenses to Cash.
- **Recording** (`record_expense`): amount above zero, date not in the future, active category and method; goes to "waiting approval" when the setting is on, otherwise posts immediately.
- **Approve / reject** (`decide_expense`) and **reverse** (`reverse_expense`) are limited to owner, manager and accountant in the database. Reversing keeps the expense on record, credits the account back and removes it from P&L. Expenses are never deleted.
- **Bills** are checked (PDF/JPG/PNG/WebP, 5 MB), stored with safe file names, opened through short-lived signed links, and removed again if the expense is refused.
- **Categories** are managed by owner/manager in Settings.
- **Profit & Loss** (`/accounts/pnl`, per month): income = taxable value of invoices issued in the month minus credit notes; expenses = posted, non-reversed expenses dated in the month, by category. GST collected is shown separately (it is owed, not income). Checked-out stays that were never invoiced are listed so they are not silently missed. A cash view shows money actually received and paid.

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~708–780: `expense_categories` (seeded), `expenses`, `after_expense_post` |
| Storage | `002_storage_buckets.sql` (`expense-receipts`) |
| Pages | `src/app/(app)/expenses/page.tsx`, `expenses/new/page.tsx`, `expenses/actions.ts` (`createExpense`, `approveExpense`) |
| P&L / income vs expense | `src/app/(app)/accounts/page.tsx`, `src/app/(app)/reports/page.tsx` |

## How to test (spec: "Expense to P&L")

1. Note current balances and P&L for the month.
2. Add expense ₹2,000 electricity, paid by cash, with a receipt image → appears in list; **Cash account** −2,000.
3. With approval enabled: expense stays pending until approved → posts on approval only (verify no account change while pending).
4. P&L expenses increase by 2,000; net profit decreases by 2,000; category totals correct.
5. Payment-method choice moves the right account (try bank).
6. No hard-delete of an expense; a wrong entry is corrected via reversal/cancel, not deletion (verify).

## Exit criteria

- [ ] One expense entry updates the correct account, expense report and P&L.
- [ ] Approval flow behaves as configured; receipts stored privately.

## Known gaps / to verify

- Approval is on/off for all expenses; there is no amount threshold.
- A reversal is counted by the expense's state (it simply drops out of P&L), not as a separate entry in the month it was reversed.
