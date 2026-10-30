"use client";

import { useState } from "react";
import { Field, inputCls, btnSoft } from "@/components/ui";
import { toast } from "@/components/Toaster";
import { addExpenseCategory } from "../actions";

type Category = { id: string; name: string };

const ADD = "__add__";

/** Category dropdown with an "Add new category" choice, so a missing category doesn't send you to Settings. */
export function CategoryField({ categories, canAdd }: { categories: Category[]; canAdd: boolean }) {
  const [list, setList] = useState(categories);
  const [value, setValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function add() {
    setPending(true);
    setError(null);
    const res = await addExpenseCategory(name);
    setPending(false);
    if ("error" in res) return setError(res.error);
    setList((prev) => [...prev, { id: res.id, name: res.name }].sort((a, b) => a.name.localeCompare(b.name)));
    setValue(res.id);
    setAdding(false);
    setName("");
    toast(`Category "${res.name}" added`);
  }

  return (
    <Field label="Category" hint={adding ? undefined : canAdd ? "Not listed? Choose “Add new category”." : undefined}>
      <select
        name="category_id"
        required
        value={value}
        onChange={(e) => {
          if (e.target.value === ADD) {
            setAdding(true);
            return;
          }
          setAdding(false);
          setValue(e.target.value);
        }}
        className={inputCls}
      >
        <option value="">Select category</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
        {canAdd ? <option value={ADD}>+ Add new category…</option> : null}
      </select>
      {adding ? (
        <span className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the category instead of submitting the whole expense.
              if (e.key === "Enter") {
                e.preventDefault();
                if (name.trim() && !pending) add();
              }
            }}
            placeholder="e.g. Laundry supplies"
            autoFocus
            aria-label="New category name"
            className={`${inputCls} !w-auto min-w-0 flex-1`}
          />
          <button type="button" onClick={add} disabled={!name.trim() || pending} className={btnSoft}>
            {pending ? "Adding…" : "Add"}
          </button>
          <button type="button" onClick={() => { setAdding(false); setError(null); }} className="text-xs font-medium text-[var(--muted)] hover:underline">
            Cancel
          </button>
          {error ? <span role="alert" className="w-full text-xs text-rose-700">{error}</span> : null}
        </span>
      ) : null}
    </Field>
  );
}
