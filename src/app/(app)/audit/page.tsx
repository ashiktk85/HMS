import Link from "next/link";
import { PageHeader, Panel, EmptyState, Field, inputCls, btnPrimary, btnSoft } from "@/components/ui";
import { DataTable } from "@/components/DataTable";
import { createClient } from "@/lib/supabase/server";
import { isDateString } from "@/lib/dates";
import { labelize, rel } from "@/lib/types";

const PAGE = 50;

const ENTITY_LINK: Record<string, string> = {
  bookings: "/bookings",
  payments: "/payments",
  invoices: "/invoices",
  expenses: "/expenses",
  guests: "/guests",
  rooms: "/rooms",
};

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Kolkata",
});

function summarize(details: unknown): string {
  if (!details || typeof details !== "object") return "—";
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

/** Every field of an audit entry's details, one per row; nested values are shown as formatted JSON. */
function detailFields(details: unknown) {
  if (!details || typeof details !== "object") return [];
  return Object.entries(details as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ({
      label: k.replace(/_/g, " "),
      wide: typeof v === "object" || String(v).length > 40,
      value:
        typeof v === "object" ? (
          <pre className="overflow-x-auto rounded-lg bg-stone-50 p-2 text-xs">{JSON.stringify(v, null, 2)}</pre>
        ) : (
          String(v)
        ),
    }));
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string; actor?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("audit_logs")
    .select("*, profiles(full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (sp.entity) query = query.eq("entity_type", sp.entity);
  if (sp.action) query = query.eq("action", sp.action);
  if (sp.actor) query = query.eq("actor_id", sp.actor);
  if (isDateString(sp.from)) query = query.gte("created_at", `${sp.from}T00:00:00+05:30`);
  if (isDateString(sp.to)) query = query.lt("created_at", `${sp.to}T23:59:59.999+05:30`);

  const [{ data: logs, count }, { data: staff }, { data: kinds }] = await Promise.all([
    query,
    supabase.from("profiles").select("id, full_name").order("full_name"),
    supabase.from("audit_logs").select("entity_type, action").order("created_at", { ascending: false }).limit(1000),
  ]);

  const entities = [...new Set((kinds || []).map((k) => k.entity_type))].sort();
  const actions = [...new Set((kinds || []).map((k) => k.action))].sort();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  const qs = (overrides: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...overrides })) if (v) p.set(k, String(v));
    return `/audit?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Who did what and when. Entries can be added but never edited or deleted. Times are hotel time (IST)."
      />

      <Panel>
        <form className="flex flex-wrap items-end gap-3">
          <Field label="Area">
            <select name="entity" defaultValue={sp.entity ?? ""} className={inputCls}>
              <option value="">All</option>
              {entities.map((e) => (
                <option key={e} value={e}>{labelize(e)}</option>
              ))}
            </select>
          </Field>
          <Field label="Action">
            <select name="action" defaultValue={sp.action ?? ""} className={inputCls}>
              <option value="">All</option>
              {actions.map((a) => (
                <option key={a} value={a}>{labelize(a)}</option>
              ))}
            </select>
          </Field>
          <Field label="Staff member">
            <select name="actor" defaultValue={sp.actor ?? ""} className={inputCls}>
              <option value="">Everyone</option>
              {(staff || []).map((s) => (
                <option key={s.id} value={s.id}>{s.full_name || "Staff"}</option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" name="from" defaultValue={sp.from ?? ""} className={inputCls} />
          </Field>
          <Field label="To">
            <input type="date" name="to" defaultValue={sp.to ?? ""} className={inputCls} />
          </Field>
          <button type="submit" className={btnPrimary}>Filter</button>
          <Link href="/audit" className={btnSoft}>Clear</Link>
        </form>
      </Panel>

      {!logs?.length ? (
        <EmptyState message="No audit entries match." />
      ) : (
        <Panel>
          <p className="mb-3 text-sm text-[var(--muted)]">
            {count} entr{count === 1 ? "y" : "ies"} · page {page} of {pages}
          </p>
          <DataTable
            pageSize={PAGE}
            serialStart={(page - 1) * PAGE}
            searchPlaceholder="Search this page"
            columns={[
              { header: "When" },
              { header: "Who" },
              { header: "Action" },
              { header: "Record" },
              { header: "Open" },
              { header: "Details", maxWidth: "32rem" },
            ]}
            rows={logs.map((l) => {
              const base = ENTITY_LINK[l.entity_type];
              const who = rel(l.profiles as { full_name: string } | { full_name: string }[] | null)?.full_name || "System";
              const details = summarize(l.details);
              return {
                key: l.id,
                details: {
                  title: `${labelize(l.action)} · ${labelize(l.entity_type)}`,
                  subtitle: `${who} · ${dateTime.format(new Date(l.created_at))}`,
                  fields: [
                    { label: "When (IST)", value: dateTime.format(new Date(l.created_at)) },
                    { label: "Who", value: who },
                    { label: "Action", value: labelize(l.action) },
                    { label: "Area", value: labelize(l.entity_type) },
                    { label: "Record ID", value: l.entity_id ? String(l.entity_id) : null, wide: true },
                    ...detailFields(l.details),
                  ],
                  actions:
                    base && l.entity_id ? (
                      <Link href={`${base}/${l.entity_id}`} className={btnPrimary}>
                        Open record
                      </Link>
                    ) : null,
                },
                search: `${who} ${labelize(l.action)} ${labelize(l.entity_type)} ${details}`,
                cells: [
                  dateTime.format(new Date(l.created_at)),
                  who,
                  <span key="a" className="font-medium">{labelize(l.action)}</span>,
                  labelize(l.entity_type),
                  base && l.entity_id ? (
                    <Link key="o" href={`${base}/${l.entity_id}`} className="font-medium text-[var(--brand)] hover:underline">
                      Open
                    </Link>
                  ) : (
                    <span key="o" className="text-[var(--muted)]">—</span>
                  ),
                  <span key="d" title={details} className="block truncate text-[var(--muted)]">{details}</span>,
                ],
              };
            })}
          />
          <div className="mt-4 flex items-center gap-2">
            {page > 1 ? (
              <Link href={qs({ page: page - 1 })} className={btnSoft}>← Newer</Link>
            ) : null}
            {page < pages ? (
              <Link href={qs({ page: page + 1 })} className={btnSoft}>Older →</Link>
            ) : null}
          </div>
        </Panel>
      )}
    </div>
  );
}
