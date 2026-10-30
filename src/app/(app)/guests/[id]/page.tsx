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
  mobileProps,
} from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DocumentUpload } from "./DocumentUpload";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { bookingLabel, formatDate, formatMoney, rel } from "@/lib/types";
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
                    {...(name === "mobile" ? mobileProps : {})}
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
            <DocumentUpload action={upload} />
            {!docs?.length ? (
              <p className="mt-4 text-sm text-[var(--muted)]">No documents uploaded yet.</p>
            ) : (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {docs.map((d) => {
                  const url = urlByPath.get(d.file_path);
                  const isPdf = d.mime_type === "application/pdf";
                  const body = (
                    <>
                      <span
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                          isPdf ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-700"
                        }`}
                      >
                        {isPdf ? "PDF" : "IMG"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.file_name}</span>
                        <span className="block text-xs text-[var(--muted)]">Uploaded {formatDate(d.created_at)}</span>
                      </span>
                      {url ? <span className="text-xs font-medium text-[var(--brand)]">View</span> : null}
                    </>
                  );
                  const cls =
                    "flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 transition";
                  return (
                    <li key={d.id}>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" className={`${cls} hover:border-[var(--brand)] hover:shadow-sm`}>
                          {body}
                        </a>
                      ) : (
                        <div className={cls}>{body}</div>
                      )}
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
          <DataTable
            searchable={bookings.length > 8}
            columns={[
              { header: "Code" },
              { header: "Room" },
              { header: "Check-in" },
              { header: "Check-out" },
              { header: "Status" },
              { header: "Balance", align: "right" },
            ]}
            rows={bookings.map((b) => {
              const room = rel(b.rooms as { room_number: string } | null)?.room_number;
              return {
                key: b.id,
                search: `${b.booking_code} ${room ?? ""} ${bookingLabel(b.status)}`,
                cells: [
                  <Link key="c" href={`/bookings/${b.id}`} className="font-medium text-[var(--brand)] hover:underline">
                    {b.booking_code}
                  </Link>,
                  room,
                  formatDate(b.check_in_date),
                  formatDate(b.check_out_date),
                  <StatusPill key="s">{bookingLabel(b.status)}</StatusPill>,
                  formatMoney(b.balance_due),
                ],
              };
            })}
          />
        )}
      </Panel>
    </div>
  );
}
