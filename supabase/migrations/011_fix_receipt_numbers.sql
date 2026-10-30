-- Fix: duplicate key value violates unique constraint "payments_receipt_no_key"
-- Run in the Supabase SQL Editor after 001-010.
--
-- Receipt numbers (RC-000001 ...) came from a sequence, but rows added with a fixed receipt
-- number (such as the sample data) never moved the sequence, so new payments could be handed
-- a number that already exists. This:
--   1. moves the sequence past the highest receipt number already used, and
--   2. hands out receipt numbers from a trigger that skips any number already taken,
--      so it cannot happen again.

select setval(
  'public.payment_receipt_seq',
  greatest(
    coalesce((select max(substring(receipt_no from 4)::bigint) from public.payments where receipt_no ~ '^RC-[0-9]+$'), 0),
    (select last_value from public.payment_receipt_seq)
  ),
  true
);

create or replace function public.assign_receipt_no()
returns trigger
language plpgsql
as $$
begin
  if new.receipt_no is null or new.receipt_no = '' then
    loop
      new.receipt_no := 'RC-' || lpad(nextval('public.payment_receipt_seq')::text, 6, '0');
      exit when not exists (select 1 from public.payments where receipt_no = new.receipt_no);
    end loop;
  end if;
  return new;
end;
$$;

alter table public.payments alter column receipt_no drop default;

drop trigger if exists payments_assign_receipt_no on public.payments;
create trigger payments_assign_receipt_no
  before insert on public.payments
  for each row execute function public.assign_receipt_no();

notify pgrst, 'reload schema';
