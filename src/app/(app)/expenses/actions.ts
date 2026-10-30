"use server";

import { requireUser, writeAudit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canAccessSettings } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { error: string };

const MAX_BILL_BYTES = 5 * 1024 * 1024;
const ALLOWED_BILL_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function revalidateExpenses(id?: string) {
  revalidatePath("/expenses");
  revalidatePath("/accounts");
  revalidatePath("/accounts/pnl");
  revalidatePath("/dashboard");
  if (id) revalidatePath(`/expenses/${id}`);
}

/** Records an expense (optionally with a bill), then opens it. */
export async function createExpense(formData: FormData): Promise<{ error: string }> {
  await requireUser();
  const supabase = await createClient();

  const amount = Number(formData.get("amount") || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above zero" };

  const file = formData.get("bill") as File | null;
  let billPath: string | null = null;
  if (file && file.size > 0) {
    if (file.size > MAX_BILL_BYTES) return { error: "The bill file is larger than 5 MB" };
    if (!ALLOWED_BILL_TYPES.includes(file.type)) {
      return { error: "Bills must be PDF, JPG, PNG or WebP" };
    }
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    billPath = `expenses/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage
      .from("expense-receipts")
      .upload(billPath, file, { contentType: file.type });
    if (upErr) return { error: upErr.message };
  }

  const { data, error } = await supabase.rpc("record_expense", {
    p_category_id: String(formData.get("category_id") || ""),
    p_amount: amount,
    p_method_id: String(formData.get("method_id") || ""),
    p_expense_date: String(formData.get("expense_date") || ""),
    p_supplier: String(formData.get("supplier") || "").trim() || null,
    p_description: String(formData.get("description") || "").trim() || null,
    p_bill_path: billPath,
  });
  if (error) {
    // Don't leave an orphan bill behind if the expense was refused.
    if (billPath) await supabase.storage.from("expense-receipts").remove([billPath]);
    return { error: error.message };
  }

  revalidateExpenses();
  redirect(`/expenses/${data}`);
}

export async function decideExpense(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("expense_id") || "");
  const { error } = await supabase.rpc("decide_expense", {
    p_expense_id: id,
    p_approve: formData.get("decision") === "approve",
    p_note: String(formData.get("note") || "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidateExpenses(id);
  return { ok: true };
}

export async function reverseExpense(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("expense_id") || "");
  const { error } = await supabase.rpc("reverse_expense", {
    p_expense_id: id,
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };
  revalidateExpenses(id);
  return { ok: true };
}

/** Adds a category from inside another form (e.g. New expense) and returns it so the form can select it. */
export async function addExpenseCategory(
  name: string,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const session = await requireUser();
  if (!canAccessSettings(session.role)) {
    return { error: "Only the owner or a manager can add expense categories." };
  }
  const clean = String(name || "").trim();
  if (!clean) return { error: "Enter a category name" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expense_categories")
    .insert({ name: clean, is_active: true })
    .select("id, name")
    .single();
  if (error) {
    return { error: error.code === "23505" ? `A category named "${clean}" already exists` : error.message };
  }
  await writeAudit("create", "expense_categories", data.id, { name: clean });
  revalidatePath("/settings");
  revalidatePath("/expenses/new");
  return { ok: true, id: data.id, name: data.name };
}

export async function saveExpenseCategory(formData: FormData): Promise<Result> {
  const session = await requireUser();
  if (!canAccessSettings(session.role)) {
    return { error: "Only owner or manager can edit expense categories." };
  }
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Name required" };
  const payload = { name, is_active: id ? formData.get("is_active") === "on" : true };
  const { error } = id
    ? await supabase.from("expense_categories").update(payload).eq("id", id)
    : await supabase.from("expense_categories").insert(payload);
  if (error) {
    return { error: error.code === "23505" ? `A category named "${name}" already exists` : error.message };
  }
  await writeAudit(id ? "update" : "create", "expense_categories", id || null, payload);
  revalidatePath("/settings");
  revalidatePath("/expenses/new");
  return { ok: true };
}
