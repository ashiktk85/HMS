import Link from "next/link";
import {
  PageHeader,
  Panel,
  EmptyState,
  Avatar,
  inputCls,
  btnPrimary,
  btnSoft,
} from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("guests")
    .select("*")
    .order("created_at", { ascending: false });

  // Commas, parentheses and wildcards would break the PostgREST filter string.
  const term = (q || "").replace(/[,()%*\\]/g, " ").trim();
  if (term) {
    query = query.or(
      `full_name.ilike.%${term}%,mobile.ilike.%${term}%,email.ilike.%${term}%`,
    );
  }
  const { data: guests } = await query.limit(100);

  return (
    <div>
      <PageHeader
        title="Guests"
        description="Profiles, ID details, and stay history."
        actions={
          <Link href="/guests/new" className={btnPrimary}>
            New guest
          </Link>
        }
      />
      <Panel className="mb-4">
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q || ""}
            placeholder="Search name, mobile, email"
            className={inputCls}
          />
          <button type="submit" className={btnSoft}>
            Search
          </button>
        </form>
      </Panel>
      {!guests?.length ? (
        <EmptyState message={term ? "No guests match your search." : "No guests yet."} />
      ) : (
        <Panel>
          <DataTable
            searchable={false}
            columns={[{ header: "Name" }, { header: "Mobile" }, { header: "Email", maxWidth: "20rem" }, { header: "GSTIN" }]}
            rows={guests.map((g) => ({
              key: g.id,
              details: {
                title: g.full_name,
                subtitle: g.mobile || g.email || undefined,
                fields: [
                  { label: "Mobile", value: g.mobile },
                  { label: "Email", value: g.email },
                  { label: "Nationality", value: g.nationality },
                  { label: "GSTIN", value: g.gstin },
                  { label: "ID type", value: g.id_type },
                  { label: "ID number", value: g.id_number },
                  { label: "Address", value: g.address, wide: true },
                  { label: "Notes", value: g.notes, wide: true },
                ],
                actions: (
                  <>
                    <Link href={`/guests/${g.id}`} className={btnPrimary}>Open profile</Link>
                    <Link href={`/bookings/new?guest_id=${g.id}`} className={btnSoft}>New booking</Link>
                  </>
                ),
              },
              cells: [
                <Link key="n" href={`/guests/${g.id}`} className="inline-flex items-center gap-2 font-medium text-[var(--brand)] hover:underline">
                  <Avatar name={g.full_name} size="sm" />
                  {g.full_name}
                </Link>,
                g.mobile || "—",
                g.email || "—",
                g.gstin || "—",
              ],
            }))}
          />
        </Panel>
      )}
    </div>
  );
}
