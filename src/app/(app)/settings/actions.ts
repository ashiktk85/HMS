"use server";

import { requireUser, writeAudit } from "@/lib/auth";
import { canAccessSettings } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateHotelSettings(formData: FormData) {
  const session = await requireUser();
  if (!canAccessSettings(session.role)) {
    return { error: "Only owner or manager can edit settings." };
  }

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("hotel_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (!existing) return { error: "Settings row missing. Run migrations." };

  const rate = (name: string) => Number(formData.get(name) || 0);
  const gstin = String(formData.get("gstin") || "").trim().toUpperCase();
  const prefix = (name: string, fallback: string) =>
    String(formData.get(name) || fallback).trim().toUpperCase();

  if (!String(formData.get("hotel_name") || "").trim()) return { error: "Hotel name required" };
  if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { error: "Hotel GSTIN is not a valid 15-character GSTIN" };
  }
  for (const name of ["cgst_rate", "sgst_rate", "igst_rate", "service_gst_rate"]) {
    const r = rate(name);
    if (!Number.isFinite(r) || r < 0 || r > 100) return { error: "GST rates must be between 0 and 100" };
  }
  for (const [name, fallback] of [
    ["gst_invoice_prefix", "GST"],
    ["non_gst_invoice_prefix", "INV"],
    ["credit_note_prefix", "CN"],
  ] as const) {
    // Prefix + "/26-27/00001" must stay within the 16 characters GST allows.
    if (!/^[A-Z0-9]{1,4}$/.test(prefix(name, fallback))) {
      return { error: "Invoice prefixes must be 1 to 4 letters or digits" };
    }
  }

  const payload = {
    hotel_name: String(formData.get("hotel_name") || "").trim(),
    address: String(formData.get("address") || "") || null,
    phone: String(formData.get("phone") || "") || null,
    email: String(formData.get("email") || "") || null,
    gstin: gstin || null,
    cgst_rate: rate("cgst_rate"),
    sgst_rate: rate("sgst_rate"),
    igst_rate: rate("igst_rate"),
    service_gst_rate: rate("service_gst_rate"),
    gst_invoice_prefix: prefix("gst_invoice_prefix", "GST"),
    non_gst_invoice_prefix: prefix("non_gst_invoice_prefix", "INV"),
    credit_note_prefix: prefix("credit_note_prefix", "CN"),
    require_refund_approval: formData.get("require_refund_approval") === "on",
    require_expense_approval: formData.get("require_expense_approval") === "on",
  };

  const { error } = await supabase
    .from("hotel_settings")
    .update(payload)
    .eq("id", existing.id);

  if (error) return { error: error.message };

  await writeAudit("update", "hotel_settings", existing.id, payload);
  revalidatePath("/settings");
  return { ok: true };
}

export async function savePaymentMethod(
  formData: FormData,
): Promise<{ ok: true } | { error: string }> {
  const session = await requireUser();
  if (!canAccessSettings(session.role)) {
    return { error: "Only owner or manager can edit payment methods." };
  }
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  const name = String(formData.get("name") || "").trim();
  const accountId = String(formData.get("account_id") || "");
  if (!name) return { error: "Name required" };
  if (!accountId) return { error: "Choose the account this method pays into" };

  const payload = {
    name,
    account_id: accountId,
    requires_reference: formData.get("requires_reference") === "on",
    is_active: id ? formData.get("is_active") === "on" : true,
  };
  const { error } = id
    ? await supabase.from("payment_methods").update(payload).eq("id", id)
    : await supabase.from("payment_methods").insert(payload);
  if (error) {
    return { error: error.code === "23505" ? `A method named "${name}" already exists` : error.message };
  }
  await writeAudit(id ? "update" : "create", "payment_methods", id || null, payload);
  revalidatePath("/settings");
  revalidatePath("/payments/new");
  return { ok: true };
}
