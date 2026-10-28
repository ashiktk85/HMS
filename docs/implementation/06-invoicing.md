# Phase 06 — Invoicing (GST / Non-GST)

**Goal:** turn a finished stay into a numbered, printable invoice with correct tax, and handle cancellation/correction safely.

**Depends on:** Phase 05 (payments), Phase 04 (folio).

## Scope

- User picks **GST** or **Non-GST** invoice
- Separate numbering prefixes/sequences (from Phase 01 settings)
- GST: customer GSTIN, configurable rates, CGST+SGST (intra-state) or IGST (inter-state); taxable value + tax breakdown
- Non-GST: no tax added
- Invoice items and tax details stored; invoice register
- Print view / PDF
- Void (controlled, audited) and credit notes; no hard delete

## Prerequisite

Run `supabase/migrations/005_invoicing.sql` in the SQL Editor (after 001–004). Also set the **hotel GSTIN** and GST rates in Settings before issuing a GST invoice.

## Decisions made in this phase

- **Numbering is atomic and gapless per financial year (Apr–Mar):** `GST/26-27/00001`, `INV/26-27/00001`, `CN/26-27/00001`. The number is allocated inside the same transaction that creates the document, so a failure never burns a number, and two people issuing at once cannot collide. Prefixes are limited to 4 characters so the number fits GST's 16-character limit. Voided invoices keep their number.
- **One calculation for preview and issue** (`calc_invoice`). Lines: room nights, extra bed, additional charges, each folio charge, discount. Accommodation lines use the room GST rates (CGST/SGST or IGST); services use the **Services GST %** (split half CGST, half SGST, or IGST). Discount comes off accommodation first. Tax is rounded once per rate group, not per line.
- **The invoice tax flows into the booking:** issuing sets `bookings.tax_total`, so the booking total, balance due, payments and accounts follow the invoice total. Credit notes reduce it (`credited_total`). Voiding removes the tax.
- **One active invoice per booking.** Charges are frozen while it exists (database trigger); void it to change them.
- **Place of supply** defaults to inter-state only when both GSTINs are known and their state codes differ; staff can switch it.
- **Billing details** (name, GSTIN, address) can differ from the guest, e.g. a company.
- **Void and credit note** are limited to owner, manager and accountant (enforced in the database). A credit note takes a pre-tax amount; GST is added in proportion; the final credit takes the exact remaining tax. An invoice with credit notes cannot be voided.
- **PDF:** the print page is the PDF source (Print → Save as PDF); it includes SAC code, tax breakup and the amount in words.
- The old second print route was removed; `/print/invoices/[id]` is the only one.

## Files

| Area | Path |
|------|------|
| DB | `001_initial_schema.sql` ~652–706: `invoices`, `invoice_items`, `tax_details`, `credit_notes` |
| Pages | `src/app/(app)/invoices/page.tsx`, `invoices/new/page.tsx`, `invoices/[id]/page.tsx`, `invoices/[id]/print/page.tsx`, `src/app/print/invoices/[id]/page.tsx` |
| Actions | `src/app/(app)/invoices/actions.ts`: `createInvoice`, `voidInvoice`, `createCreditNote` |
| Libs | `jspdf`, `jspdf-autotable` |

## How to test (spec: "GST Invoice" and "Non-GST Invoice")

1. Stay with room ₹5,000 + folio ₹500. Create a **GST** invoice for an in-state guest → CGST + SGST split equals configured rate; taxable value + tax = total; number uses the GST prefix.
2. Create a GST invoice for an out-of-state GSTIN → **IGST** only.
3. Create a **Non-GST** invoice → total = taxable amount, zero tax, different prefix/sequence.
4. Create several invoices → numbers are sequential with no gaps or duplicates (try two quickly).
5. Print/PDF: all fields present (hotel GSTIN, guest GSTIN, items, tax breakdown).
6. Void an invoice → stays in the register as void with audit log; number is not reused. Issue a credit note against another → original still visible.
7. Change the GST rate in settings → new invoices use it; old invoices remain unchanged.

## Exit criteria

- [ ] Tax maths correct in GST (intra and inter-state) and zero in Non-GST.
- [ ] Sequential numbering per type; configurable prefixes.
- [ ] Print/PDF usable; void/credit-note leave an audit trail.

## Known gaps / to verify

- Spec lists GST summary as a report; that lives in Phase 09.
- GST on hotel rooms depends on the per-night tariff slab. This build uses one configurable room rate and one services rate; if rooms span slabs with different rates, confirm the setup with the hotel's accountant.
- Invoice creation is open to all staff; void and credit note are role-limited in the database.
