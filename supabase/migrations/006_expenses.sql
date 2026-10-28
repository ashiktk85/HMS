-- Phase 07: expenses and Profit & Loss
-- Run in the Supabase SQL Editor after 001-005.
--
-- 0. Fix from Phase 06: staff could call next_document_number() directly and burn invoice
--    numbers. On Supabase, signed-in users get an explicit grant, so revoke it from them too.
-- 1. Expenses are paid through a payment method, which decides the account debited
--    (same table as payments; fixes the old name matching that fell back to Cash).
-- 2. Recording, approving/rejecting and reversing an expense run inside the database.
--    Expenses are never deleted; a mistake is reversed, which credits the account back.

-- ========== 0. numbering grant fix ==========
revoke execute on function public.next_document_number(text, text) from authenticated;

-- ========== schema ==========
alter table public.expenses
  add column if not exists account_id uuid references public.accounts(id),
  add column if not exists decided_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists reversed boolean not null default false,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles(id),
  add column if not exists reverse_reason text;

update public.expenses e
set account_id = coalesce(
  (select a.id from public.accounts a
   where lower(a.name) = lower(e.payment_method) or a.kind::text = lower(e.payment_method) limit 1),
  (select id from public.accounts where kind = 'cash' limit 1))
where e.account_id is null;

alter table public.expenses alter column account_id set not null;

create index if not exists expenses_date_idx on public.expenses (expense_date);

-- ========== ledger triggers ==========
create or replace function public.after_expense_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.posted then return new; end if;
  if tg_op = 'UPDATE' and old.posted then return new; end if;
  if new.approval_status in ('pending', 'rejected') then return new; end if;

  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, created_by
  ) values (
    new.account_id, 'debit', new.amount,
    'Expense: ' || coalesce(new.supplier || ' - ', '') || coalesce(new.description, ''),
    'expense', new.id, coalesce(new.approved_by, new.created_by)
  );
  return new;
end;
$$;

create or replace function public.after_expense_reverse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.account_transactions (
    account_id, txn_type, amount, description, reference_type, reference_id, created_by
  ) values (
    new.account_id, 'credit', new.amount,
    'Expense reversed: ' || coalesce(new.reverse_reason, ''),
    'expense_reversal', new.id, new.reversed_by
  );
  return new;
end;
$$;

drop trigger if exists expenses_after_reverse on public.expenses;
create trigger expenses_after_reverse
  after update of reversed on public.expenses
  for each row when (old.reversed = false and new.reversed = true and new.posted = true)
  execute function public.after_expense_reverse();

-- ========== record ==========
create or replace function public.record_expense(
  p_category_id uuid,
  p_amount numeric,
  p_method_id uuid,
  p_expense_date date,
  p_supplier text default null,
  p_description text default null,
  p_bill_path text default null
)
returns uuid
language plpgsql
as $$
declare
  m public.payment_methods%rowtype;
  amt numeric(12,2);
  needs_approval boolean;
  eid uuid;
begin
  amt := round(p_amount, 2);
  if amt is null or amt <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_expense_date is null then raise exception 'Enter the expense date'; end if;
  if p_expense_date > public.hotel_today() then raise exception 'The expense date cannot be in the future'; end if;
  if not exists (select 1 from public.expense_categories where id = p_category_id and is_active) then
    raise exception 'Choose an expense category';
  end if;
  select * into m from public.payment_methods where id = p_method_id and is_active;
  if not found then raise exception 'Choose how it was paid'; end if;

  select coalesce((select require_expense_approval from public.hotel_settings limit 1), false)
  into needs_approval;

  insert into public.expenses (
    category_id, amount, supplier, payment_method, account_id, description, bill_path,
    approval_status, expense_date, posted, created_by
  ) values (
    p_category_id, amt, nullif(trim(p_supplier), ''), m.name, m.account_id,
    nullif(trim(p_description), ''), p_bill_path,
    case when needs_approval then 'pending' else 'not_required' end::public.expense_approval,
    p_expense_date, not needs_approval, auth.uid()
  ) returning id into eid;

  perform public.write_audit('create', 'expenses', eid, jsonb_build_object(
    'amount', amt, 'method', m.name, 'needs_approval', needs_approval, 'supplier', p_supplier));
  return eid;
end;
$$;

-- ========== approve / reject ==========
create or replace function public.decide_expense(
  p_expense_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
as $$
declare
  e public.expenses%rowtype;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can approve expenses';
  end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if e.approval_status <> 'pending' then raise exception 'This expense was already %', e.approval_status; end if;

  update public.expenses
  set approval_status = case when p_approve then 'approved' else 'rejected' end::public.expense_approval,
      approved_by = auth.uid(),
      decided_at = now(),
      decision_note = nullif(trim(p_note), ''),
      posted = p_approve
  where id = e.id;

  perform public.write_audit(case when p_approve then 'approve' else 'reject' end,
    'expenses', e.id, jsonb_build_object('amount', e.amount, 'note', p_note));
end;
$$;

-- ========== reverse (correct a posted mistake) ==========
create or replace function public.reverse_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
as $$
declare
  e public.expenses%rowtype;
begin
  if not public.has_role(array['owner', 'manager', 'accountant']::public.app_role[]) then
    raise exception 'Only the owner, a manager or the accountant can reverse an expense';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to reverse an expense'; end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if e.reversed then raise exception 'This expense is already reversed'; end if;
  if not e.posted then raise exception 'Only posted expenses can be reversed; reject a pending one instead'; end if;

  update public.expenses
  set reversed = true, reversed_at = now(), reversed_by = auth.uid(), reverse_reason = trim(p_reason)
  where id = e.id;

  perform public.write_audit('reverse', 'expenses', e.id, jsonb_build_object(
    'amount', e.amount, 'reason', trim(p_reason)));
end;
$$;

revoke execute on function
  public.record_expense(uuid, numeric, uuid, date, text, text, text),
  public.decide_expense(uuid, boolean, text),
  public.reverse_expense(uuid, text)
from public, anon;
grant execute on function
  public.record_expense(uuid, numeric, uuid, date, text, text, text),
  public.decide_expense(uuid, boolean, text),
  public.reverse_expense(uuid, text)
to authenticated;

notify pgrst, 'reload schema';
