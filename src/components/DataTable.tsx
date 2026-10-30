"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";

/** Everything about one row, shown in a side sheet when the row is clicked. */
export type RowDetails = {
  title: string;
  subtitle?: string;
  /** Label / value pairs. Long values wrap; nothing is cut off here. */
  fields: { label: string; value: React.ReactNode; wide?: boolean }[];
  /** Buttons or links shown under the fields (e.g. "Open booking"). */
  actions?: React.ReactNode;
};

export type Column = {
  header: string;
  align?: "left" | "right" | "center";
  /** Cap the column width; longer text is cut off with an ellipsis (one line per cell, always). */
  maxWidth?: string;
};
export type TableRow = {
  key: string;
  cells: React.ReactNode[];
  /** Text the search box looks through. Defaults to nothing, so pass it when search is on. */
  search?: string;
  /** Values for the column filters, e.g. { status: "issued" }. */
  filter?: Record<string, string>;
  /** Extra classes for the row (e.g. to dim an inactive row). */
  className?: string;
  /** When set, clicking the row opens a sheet with all of these details. */
  details?: RowDetails;
};
export type TableFilter = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/**
 * Compact one-line-per-cell table with a serial number column, optional search, filters and paging.
 * Search and filters work on the rows given (the page decides how many are loaded).
 */
export function DataTable({
  columns,
  rows,
  searchable = true,
  searchPlaceholder = "Search…",
  filters = [],
  pageSize = 25,
  emptyMessage = "Nothing to show.",
  footer,
  serialStart = 0,
}: {
  /** S.No offset, for tables the server pages through (page 2 starts after page 1's rows). */
  serialStart?: number;
  columns: Column[];
  rows: TableRow[];
  searchable?: boolean;
  searchPlaceholder?: string;
  filters?: TableFilter[];
  pageSize?: number;
  emptyMessage?: string;
  /** Optional totals row, one node per column (S.No column is added for you). */
  footer?: React.ReactNode[];
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openRow = rows.find((r) => r.key === openKey);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(r.search ?? "").toLowerCase().includes(q)) return false;
      return filters.every((f) => !picked[f.key] || r.filter?.[f.key] === picked[f.key]);
    });
  }, [rows, query, picked, filters]);

  const pages = Math.max(Math.ceil(visible.length / pageSize), 1);
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  const shown = visible.slice(start, start + pageSize);
  const hasTools = searchable || filters.length > 0;
  const narrowed = query.trim() !== "" || Object.values(picked).some(Boolean);

  const fieldCls =
    "h-8 rounded-lg border border-[var(--line)] bg-white px-2.5 text-[13px] text-[var(--ink)] placeholder:text-[var(--muted)]";

  return (
    <div>
      {hasTools ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {searchable ? (
            <div className="relative">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-[var(--muted)]" aria-hidden>
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.5-3.5" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
                placeholder={searchPlaceholder}
                aria-label="Search table"
                className={`${fieldCls} w-60 pl-8`}
              />
            </div>
          ) : null}
          {filters.map((f) => (
            <select
              key={f.key}
              value={picked[f.key] ?? ""}
              onChange={(e) => {
                setPicked((p) => ({ ...p, [f.key]: e.target.value }));
                setPage(0);
              }}
              aria-label={f.label}
              className={fieldCls}
            >
              <option value="">{f.label}</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          ))}
          {narrowed ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setPicked({});
                setPage(0);
              }}
              className="text-xs font-medium text-[var(--brand)] hover:underline"
            >
              Clear
            </button>
          ) : null}
          <span className="ml-auto text-xs text-[var(--muted)]">
            {narrowed ? `${visible.length} of ${rows.length}` : `${rows.length}`} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="w-full whitespace-nowrap text-left text-[13px]">
          <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="w-12 px-3 py-2 text-center font-semibold">S.No</th>
              {columns.map((c) => (
                <th key={c.header} className={`px-3 py-2 font-semibold ${ALIGN[c.align ?? "left"]}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-[var(--muted)]">
                  {rows.length === 0 ? emptyMessage : "No rows match your search or filters."}
                </td>
              </tr>
            ) : (
              shown.map((r, i) => (
                <tr
                  key={r.key}
                  onClick={
                    r.details
                      ? (e) => {
                          // Links, buttons and form fields inside the row keep their own behaviour.
                          if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label, form")) return;
                          setOpenKey(r.key);
                        }
                      : undefined
                  }
                  className={`transition hover:bg-[var(--brand-tint)]/60 ${r.details ? "cursor-pointer" : ""} ${r.className ?? ""}`}
                >
                  <td className="px-3 py-1.5 text-center tabular-nums text-[var(--muted)]">{serialStart + start + i + 1}</td>
                  {r.cells.map((cell, ci) => {
                    const col = columns[ci];
                    return (
                      <td
                        key={ci}
                        style={col?.maxWidth ? { maxWidth: col.maxWidth } : undefined}
                        className={`px-3 py-1.5 ${ALIGN[col?.align ?? "left"]} ${col?.maxWidth ? "overflow-hidden text-ellipsis" : ""}`}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {footer && visible.length > 0 ? (
            <tfoot className="border-t border-[var(--line)] bg-stone-50 font-semibold">
              <tr>
                <td className="px-3 py-2" />
                {footer.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2 ${ALIGN[columns[ci]?.align ?? "left"]}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {visible.length > pageSize ? (
        <div className="mt-3 flex items-center justify-between text-xs text-[var(--muted)]">
          <span>
            Showing {start + 1}–{Math.min(start + pageSize, visible.length)} of {visible.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              className="rounded-lg border border-[var(--line)] px-2.5 py-1 font-medium hover:bg-[var(--brand-tint)] disabled:opacity-40"
            >
              Previous
            </button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              className="rounded-lg border border-[var(--line)] px-2.5 py-1 font-medium hover:bg-[var(--brand-tint)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <Sheet
        open={!!openRow?.details}
        onClose={() => setOpenKey(null)}
        title={openRow?.details?.title ?? ""}
        subtitle={openRow?.details?.subtitle}
        width="max-w-2xl"
      >
        {openRow?.details ? (
          <>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {openRow.details.fields.map((f) => (
                <div key={f.label} className={f.wide ? "sm:col-span-2" : ""}>
                  <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{f.label}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-sm">{f.value || "—"}</dd>
                </div>
              ))}
            </dl>
            {openRow.details.actions ? (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">{openRow.details.actions}</div>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
