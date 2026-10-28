import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  Avatar,
  StatusPill,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, labelize, rel } from "@/lib/types";
import { notFound } from "next/navigation";
import { updateGuest, uploadGuestDocument } from "../actions";

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default async function GuestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: guest } = await supabase
    .from("guests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!guest) notFound();

  const [{ data: docs }, { data: bookings }] = await Promise.all([
    supabase
      .from("guest_documents")
      .select("*")
      .eq("guest_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("*, rooms(room_number)")
      .eq("guest_id", id)
      .order("check_in_date", { ascending: false }),
  ]);

  // Storage is private: hand out short-lived signed links so staff can open files.
  const signed = docs?.length
    ? await supabase.storage
        .from("guest-documents")
        .createSignedUrls(
          docs.map((d) => d.file_path),
          3600,
        )
    : null;
  const urlByPath = new Map(
    (signed?.data || []).map((s) => [s.path, s.signedUrl] as const),
  );

  const outstanding = (bookings || []).reduce(
    (sum, b) => sum + Number(b.balance_due || 0),
    0,
  );

  async function save(formData: FormData) {
    "use server";
    formData.set("id", id);
    return updateGuest(formData);
  }
  async function upload(formData: FormData) {
    "use server";
    formData.set("guest_id", id);
    return uploadGuestDocument(formData);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guest profile"
        actions={
          <>
            <Link href="/guests" className={btnSoft}>
              All guests
            </Link>
            <Link href={`/bookings/new?guest_id=${id}`} className={btnPrimary}>
              New booking
            </Link>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <Avatar name={guest.full_name} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{guest.full_name}</p>
              <p className="text-xs text-[var(--muted)]">
                Guest since {formatDate(guest.created_at)}
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-1 border-t border-[var(--line)] pt-4 text-sm">
            <p>{guest.mobile || "No mobile"}</p>
            <p className="truncate">{guest.email || "No email"}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--line)] pt-4">
            <Info label="Nationality" value={guest.nationality} />
            <Info label="ID type" value={guest.id_type} />
            <Info label="ID number" value={guest.id_number} />
            <Info label="GSTIN" value={guest.gstin} />
          </div>
          <div className="mt-4 rounded-xl bg-[var(--brand-tint)] p-3">
            <p className="text-xs text-[var(--muted)]">Outstanding across stays</p>
            <p className="text-lg font-semibold">{formatMoney(outstanding)}</p>
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <h3 className="mb-3 font-semibold">Edit details</h3>
            <ActionForm action={save} className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["full_name", guest.full_name],
                  ["mobile", guest.mobile],
                  ["email", guest.email],
                  ["address", guest.address],
                  ["nationality", guest.nationality],
                  ["id_type", guest.id_type],
                  ["id_number", guest.id_number],
                  ["gstin", guest.gstin],
                ] as const
              ).map(([name, value]) => (
                <label key={name} className="text-sm">
                  <span className="capitalize text-[var(--muted)]">
                    {name.replace(/_/g, " ")}
                  </span>
                  <input
                    name={name}
                    required={name === "full_name"}
                    defaultValue={value ?? ""}
                    className={`${inputCls} mt-1`}
                  />
                </label>
              ))}
              <label className="text-sm md:col-span-2">
                <span className="text-[var(--muted)]">Notes</span>
                <textarea name="notes" defaultValue={guest.notes ?? ""} rows={2} className={`${inputCls} mt-1`} />
              </label>
              <SubmitButton className={`${btnPrimary} md:col-span-2`}>Save guest</SubmitButton>
            </ActionForm>
          </Panel>

          <Panel>
            <h3 className="mb-3 font-semibold">ID documents</h3>
            <ActionForm
              action={upload}
              resetOnSuccess
              successMessage="Document uploaded"
              className="mb-4 flex flex-wrap items-center gap-2"
            >
              <input
                type="file"
                name="file"
                required
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="text-sm"
              />
              <SubmitButton className={btnSoft} pendingLabel="Uploading…">Upload</SubmitButton>
            </ActionForm>
            <p className="-mt-2 mb-3 text-xs text-[var(--muted)]">PDF, JPG, PNG or WebP, up to 5 MB.</p>
            {!docs?.length ? (
              <EmptyState message="No documents uploaded." />
            ) : (
              <ul className="divide-y divide-[var(--line)] text-sm">
                {docs.map((d) => {
                  const url = urlByPath.get(d.file_path);
                  return (
                    <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className="truncate font-medium text-[var(--brand)] hover:underline">
                          {d.file_name}
                        </a>
                      ) : (
                        <span className="truncate">{d.file_name}</span>
                      )}
                      <span className="shrink-0 text-xs text-[var(--muted)]">{formatDate(d.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <Panel>
        <h3 className="mb-3 font-semibold">Stay history</h3>
        {!bookings?.length ? (
          <EmptyState message="No bookings yet for this guest." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Code</th>
                  <th className="font-medium">Room</th>
                  <th className="font-medium">Dates</th>
                  <th className="font-medium">Status</th>
                  <th className="font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--line)]">
                    <td className="py-2">
                      <Link href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                        {b.booking_code}
                      </Link>
                    </td>
                    <td>{rel(b.rooms as { room_number: string } | null)?.room_number}</td>
                    <td>
                      {formatDate(b.check_in_date)} → {formatDate(b.check_out_date)}
                    </td>
                    <td>
                      <StatusPill>{labelize(b.status)}</StatusPill>
                    </td>
                    <td>{formatMoney(b.balance_due)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
