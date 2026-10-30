-- Phase 11: one invoice for several bookings of the same guest
-- Run in the Supabase SQL Editor after 001-009.
--
-- A guest who books two (or more) rooms separately can be billed on ONE invoice.
--   * invoices.booking_id stays as the "primary" booking, so existing screens keep working.
--   * invoice_bookings lists every booking on an invoice (including the primary one) with
--     that booking's share of the taxable value / tax / total.
--   * Each booking still carries its own tax_total, payments and balance, so payments
--     recorded per room keep working; the invoice shows the combined total and combined payments.
--   * A booking can only be on one active (issued / credited) invoice.
--   * Voiding removes the tax from every booking; a credit note is spread across the bookings
--     in proportion to their share of the invoice.

-- ========== link table ==========
create table if not exists public.invoice_bookings (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  booking_id uuid not null references public.bookings(id),
  taxable_value numeric(12,2) not null default 0,
  tax_total numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  primary key (invoice_id, booking_id)
);
create index if not exists invoice_bookings_booking_idx on public.invoice_bookings (booking_id);

alter table public.invoice_bookings enable row level security;
drop policy if exists "staff_read_invoice_bookings" on public.invoice_bookings;
create policy "staff_read_invoice_bookings" on public.invoice_bookings
  for select to authenticated using (true);

-- Existing invoices become one-booking invoices.
insert into public.invoice_bookings (invoice_id, booking_id, taxable_value, tax_total, total)
select id, booking_id, taxable_value, cgst_amount + sgst_amount + igst_amount, total_amount
from public.invoices
on conflict do nothing;

-- ========== calculation across several bookings ==========
create or replace function public.calc_combined_invoice(
  p_booking_ids uuid[],
  p_type public.invoice_type,
  p_inter boolean
)
returns jsonb
language plpgsql
stable
as $$
declare
  bid uuid;
  one jsonb;
  code text;
  ln jsonb;
  multi boolean := coalesce(array_length(p_booking_ids, 1), 0) > 1;
  lines jsonb := '[]'::jsonb;
  per jsonb := '[]'::jsonb;
  all_rows jsonb := '[]'::jsonb;
  tax_rows jsonb;
  taxable numeric := 0; cg numeric := 0; sg numeric := 0; ig numeric := 0;
  tt numeric := 0; tot numeric := 0;
begin
  if p_booking_ids is null or coalesce(array_length(p_booking_ids, 1), 0) = 0 then
    raise exception 'Select at least one booking';
  end if;

  foreach bid in array p_booking_ids loop
    one := public.calc_invoice(bid, p_type, p_inter);
    select booking_code into code from public.bookings where id = bid;

    for ln in select * from jsonb_array_elements(one -> 'lines') loop
      if multi then
        ln := jsonb_set(ln, '{description}', to_jsonb((ln ->> 'description') || ' [' || code || ']'));
      end if;
      lines := lines || ln;
    end loop;

    all_rows := all_rows || (one -> 'tax_rows');
    taxable := taxable + (one ->> 'taxable_value')::numeric;
    cg := cg + (one ->> 'cgst')::numeric;
    sg := sg + (one ->> 'sgst')::numeric;
    ig := ig + (one ->> 'igst')::numeric;
    tt := tt + (one ->> 'tax_total')::numeric;
    tot := tot + (one ->> 'total')::numeric;
    per := per || jsonb_build_object(
      'booking_id', bid,
      'taxable_value', (one ->> 'taxable_value')::numeric,
      'tax_total', (one ->> 'tax_total')::numeric,
      'total', (one ->> 'total')::numeric);
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', name, 'rate', rate, 'taxable', tx, 'amount', amt) order by name, rate), '[]'::jsonb)
  into tax_rows
  from (
    select r ->> 'name' as name, (r ->> 'rate')::numeric as rate,
           sum((r ->> 'taxable')::numeric) as tx, sum((r ->> 'amount')::numeric) as amt
    from jsonb_array_elements(all_rows) r
    group by 1, 2
  ) t;

  return jsonb_build_object(
    'type', p_type,
    'inter_state', p_inter,
    'lines', lines,
    'taxable_value', taxable,
    'cgst', cg, 'sgst', sg, 'igst', ig,
    'tax_total', tt,
    'total', tot,
    'tax_rows', tax_rows,
    'per_booking', per);
end;
$$;

-- ========== issue one invoice for one or more bookings ==========
create or replace function public.issue_combined_invoice(
  p_booking_ids uuid[],
  p_type public.invoice_type,
  p_inter boolean,
  p_billing_name text default null,
  p_billing_gstin text default null,
  p_billing_address text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  n int;
  primary_id uuid;
  b public.bookings%rowtype;
  s public.hotel_settings%rowtype;
  g public.guests%rowtype;
  calc jsonb;
  inv_id uuid;
  num text;
  gstin text;
  ln jsonb;
  tr jsonb;
  pb jsonb;
begin
  -- De-duplicate, keeping the order given; the first booking is the primary one.
  ids := array(
    select x from unnest(p_booking_ids) with ordinality as t(x, o)
    group by x order by min(o));
  n := coalesce(array_length(ids, 1), 0);
  if n = 0 then raise exception 'Select at least one booking'; end if;
  primary_id := ids[1];

  perform 1 from public.bookings where id = any(ids) order by id for update;

  if (select count(*) from public.bookings where id = any(ids)) <> n then
    raise exception 'Booking not found';
  end if;
  if (select count(distinct guest_id) from public.bookings where id = any(ids)) > 1 then
    raise exception 'Only bookings of the same guest can be billed together';
  end if;
  if exists (select 1 from public.bookings where id = any(ids) and status not in ('checked_in', 'checked_out')) then
    raise exception 'Invoice bookings once the guest has checked in';
  end if;
  if exists (
    select 1 from public.invoice_bookings ib
    join public.invoices i on i.id = ib.invoice_id
    where ib.booking_id = any(ids) and i.status in ('issued', 'credited')
  ) then
    raise exception 'One of these bookings already has an invoice. Void it first to issue a new one.';
  end if;

  select * into b from public.bookings where id = primary_id;
  select * into s from public.hotel_settings limit 1;
  select * into g from public.guests where id = b.guest_id;

  gstin := nullif(upper(trim(coalesce(p_billing_gstin, ''))), '');
  if p_type = 'gst' then
    if coalesce(trim(s.gstin), '') = '' then
      raise exception 'Set the hotel GSTIN in Settings before issuing GST invoices';
    end if;
    if gstin is not null and gstin !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then
      raise exception 'The customer GSTIN is not valid';
    end if;
  else
    gstin := null;
  end if;

  calc := public.calc_combined_invoice(ids, p_type, coalesce(p_inter, false) and p_type = 'gst');
  if (calc ->> 'total')::numeric <= 0 then raise exception 'There is nothing to invoice'; end if;

  num := public.next_document_number(
    case when p_type = 'gst' then 'gst' else 'non_gst' end,
    case when p_type = 'gst' then s.gst_invoice_prefix else s.non_gst_invoice_prefix end);

  insert into public.invoices (
    booking_id, guest_id, invoice_type, invoice_number, status,
    customer_gstin, hotel_gstin, billing_name, billing_address,
    taxable_value, cgst_amount, sgst_amount, igst_amount, total_amount,
    is_inter_state, notes, issued_by, fiscal_year
  ) values (
    primary_id, b.guest_id, p_type, num, 'issued',
    gstin, case when p_type = 'gst' then s.gstin end,
    coalesce(nullif(trim(p_billing_name), ''), g.full_name),
    coalesce(nullif(trim(p_billing_address), ''), g.address),
    (calc ->> 'taxable_value')::numeric, (calc ->> 'cgst')::numeric,
    (calc ->> 'sgst')::numeric, (calc ->> 'igst')::numeric, (calc ->> 'total')::numeric,
    coalesce(p_inter, false) and p_type = 'gst', nullif(trim(p_notes), ''), auth.uid(),
    public.fiscal_year_label()
  ) returning id into inv_id;

  for ln in select * from jsonb_array_elements(calc -> 'lines') loop
    insert into public.invoice_items (invoice_id, description, quantity, unit_amount, amount, tax_rate, sac_code)
    values (inv_id, ln ->> 'description', (ln ->> 'quantity')::numeric, (ln ->> 'unit_amount')::numeric,
            (ln ->> 'amount')::numeric, (ln ->> 'tax_rate')::numeric, ln ->> 'sac_code');
  end loop;

  for tr in select * from jsonb_array_elements(calc -> 'tax_rows') loop
    insert into public.tax_details (invoice_id, tax_name, rate, amount)
    values (inv_id, tr ->> 'name', (tr ->> 'rate')::numeric, (tr ->> 'amount')::numeric);
  end loop;

  -- Each booking takes its own share of the tax (recomputed into its total by the bookings trigger).
  for pb in select * from jsonb_array_elements(calc -> 'per_booking') loop
    insert into public.invoice_bookings (invoice_id, booking_id, taxable_value, tax_total, total)
    values (inv_id, (pb ->> 'booking_id')::uuid, (pb ->> 'taxable_value')::numeric,
            (pb ->> 'tax_total')::numeric, (pb ->> 'total')::numeric);
    update public.bookings set tax_total = (pb ->> 'tax_total')::numeric
    where id = (pb ->> 'booking_id')::uuid;
  end loop;

  perform public.write_audit('create', 'invoices', inv_id, jsonb_build_object(
    'invoice_number', num, 'type', p_type, 'total', (calc ->> 'total')::numeric,
    'booking_ids', to_jsonb(ids)));
  return inv_id;
end;
$$;

-- The single-booking function now goes through the same code (so the checks above also apply).
create or replace function public.issue_invoice(
  p_booking_id uuid,
  p_type public.invoice_type,
  p_inter boolean,
  p_billing_name text default null,
  p_billing_gstin text default null,
  p_billing_address text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.issue_combined_invoice(
    array[p_booking_id], p_type, p_inter, p_billing_name, p_billing_gstin, p_billing_address, p_notes);
end;
$$;

-- ========== void: take the tax off every booking on the invoice ==========
create or replace function public.void_invoice(p_invoice_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  i public.invoices%rowtype;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can void an invoice';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to void an invoice'; end if;

  select * into i from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status = 'voided' then raise exception 'This invoice is already voided'; end if;
  if exists (select 1 from public.credit_notes where invoice_id = i.id) then
    raise exception 'This invoice has credit notes, so it cannot be voided';
  end if;

  update public.invoices
  set status = 'voided', voided_at = now(), void_reason = trim(p_reason)
  where id = i.id;
  update public.bookings set tax_total = 0
  where id = i.booking_id
     or id in (select booking_id from public.invoice_bookings where invoice_id = i.id);

  perform public.write_audit('void', 'invoices', i.id, jsonb_build_object(
    'invoice_number', i.invoice_number, 'total', i.total_amount, 'reason', trim(p_reason)));
end;
$$;

-- ========== credit note: spread across the bookings on the invoice ==========
create or replace function public.create_credit_note(
  p_invoice_id uuid,
  p_taxable numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  i public.invoices%rowtype;
  s public.hotel_settings%rowtype;
  amt numeric(12,2);
  taken_t numeric; taken_c numeric; taken_s numeric; taken_i numeric;
  remaining numeric;
  c numeric; sg numeric; ig numeric;
  cn_id uuid;
  num text;
  total numeric;
  ib record;
  nb int;
  k int := 0;
  allocated numeric := 0;
  share numeric;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can issue a credit note';
  end if;
  amt := round(p_taxable, 2);
  if amt is null or amt <= 0 then raise exception 'Enter a credit amount above zero'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required for a credit note'; end if;

  select * into i from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if i.status <> 'issued' then
    raise exception 'Credit notes can only be raised against an issued invoice (this one is %)', i.status;
  end if;

  select coalesce(sum(taxable_value), 0), coalesce(sum(cgst_amount), 0),
         coalesce(sum(sgst_amount), 0), coalesce(sum(igst_amount), 0)
  into taken_t, taken_c, taken_s, taken_i
  from public.credit_notes where invoice_id = i.id;

  remaining := i.taxable_value - taken_t;
  if amt > remaining then
    raise exception 'Only % (before tax) can still be credited on this invoice', remaining;
  end if;

  if amt = remaining then
    -- Final credit takes whatever tax is left, so rounding never leaves a remainder.
    c := i.cgst_amount - taken_c; sg := i.sgst_amount - taken_s; ig := i.igst_amount - taken_i;
  else
    c := round(amt / i.taxable_value * i.cgst_amount, 2);
    sg := round(amt / i.taxable_value * i.sgst_amount, 2);
    ig := round(amt / i.taxable_value * i.igst_amount, 2);
  end if;
  total := amt + c + sg + ig;

  select * into s from public.hotel_settings limit 1;
  num := public.next_document_number('credit_note', s.credit_note_prefix);

  insert into public.credit_notes (
    invoice_id, credit_note_number, amount, taxable_value,
    cgst_amount, sgst_amount, igst_amount, reason, created_by, fiscal_year
  ) values (
    i.id, num, total, amt, c, sg, ig, trim(p_reason), auth.uid(), public.fiscal_year_label()
  ) returning id into cn_id;

  select count(*) into nb from public.invoice_bookings where invoice_id = i.id;
  if nb <= 1 then
    update public.bookings set credited_total = credited_total + total where id = i.booking_id;
  else
    -- In proportion to each booking's share of the invoice; the last one takes the rounding remainder.
    for ib in select * from public.invoice_bookings where invoice_id = i.id order by booking_id loop
      k := k + 1;
      if k = nb then
        share := total - allocated;
      else
        share := round(total * ib.total / nullif(i.total_amount, 0), 2);
      end if;
      allocated := allocated + share;
      update public.bookings set credited_total = credited_total + share where id = ib.booking_id;
    end loop;
  end if;

  if amt = remaining then
    update public.invoices set status = 'credited' where id = i.id;
  end if;

  perform public.write_audit('credit_note', 'invoices', i.id, jsonb_build_object(
    'credit_note_number', num, 'taxable', amt, 'total', total, 'reason', trim(p_reason)));
  return cn_id;
end;
$$;

-- ========== freeze charges on every invoiced booking ==========
create or replace function public.guard_folio_when_invoiced()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.invoice_bookings ib
    join public.invoices i on i.id = ib.invoice_id
    where ib.booking_id = new.booking_id and i.status in ('issued', 'credited')
  ) or exists (
    select 1 from public.invoices
    where booking_id = new.booking_id and status in ('issued', 'credited')
  ) then
    raise exception 'This booking has an invoice. Void the invoice before changing its charges.';
  end if;
  return new;
end;
$$;

-- ========== permissions ==========
revoke execute on function
  public.calc_combined_invoice(uuid[], public.invoice_type, boolean),
  public.issue_combined_invoice(uuid[], public.invoice_type, boolean, text, text, text, text)
from public, anon;
grant execute on function
  public.calc_combined_invoice(uuid[], public.invoice_type, boolean),
  public.issue_combined_invoice(uuid[], public.invoice_type, boolean, text, text, text, text)
to authenticated;

notify pgrst, 'reload schema';
