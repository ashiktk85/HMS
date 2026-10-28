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
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[var(--muted)]">
                <tr>
                  <th className="py-2 font-medium">Name</th>
                  <th className="font-medium">Mobile</th>
                  <th className="font-medium">Email</th>
                  <th className="font-medium">GSTIN</th>
                </tr>
              </thead>
              <tbody>
                {guests.map((g) => (
                  <tr key={g.id} className="border-t border-[var(--line)]">
                    <td className="py-3">
                      <Link
                        href={`/guests/${g.id}`}
                        className="flex items-center gap-3 font-medium text-[var(--brand)] hover:underline"
                      >
                        <Avatar name={g.full_name} />
                        {g.full_name}
                      </Link>
                    </td>
                    <td>{g.mobile || "—"}</td>
                    <td>{g.email || "—"}</td>
                    <td>{g.gstin || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
