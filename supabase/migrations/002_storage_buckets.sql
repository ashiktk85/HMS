-- Storage buckets for HMS (run in Supabase SQL editor after 001_initial_schema.sql)

insert into storage.buckets (id, name, public)
values
  ('guest-documents', 'guest-documents', false),
  ('expense-receipts', 'expense-receipts', false)
on conflict (id) do nothing;

create policy "staff_read_guest_docs"
on storage.objects for select to authenticated
using (bucket_id = 'guest-documents');

create policy "staff_upload_guest_docs"
on storage.objects for insert to authenticated
with check (bucket_id = 'guest-documents');

create policy "staff_read_expense_receipts"
on storage.objects for select to authenticated
using (bucket_id = 'expense-receipts');

create policy "staff_upload_expense_receipts"
on storage.objects for insert to authenticated
with check (bucket_id = 'expense-receipts');
