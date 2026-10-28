"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { error: string };

function revalidateInvoicing(bookingId?: string) {
  revalidatePath("/invoices");
  revalidatePath("/accounts");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
  if (bookingId) revalidatePath(`/bookings/${bookingId}`);
}

/** Issues the invoice in one database transaction, then opens it. */
export async function issueInvoice(formData: FormData): Promise<{ error: string }> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const type = String(formData.get("invoice_type") || "");
  if (!bookingId) return { error: "Select a booking" };
  if (type !== "gst" && type !== "non_gst") return { error: "Choose GST or Non-GST invoice" };

  const { data, error } = await supabase.rpc("issue_invoice", {
    p_booking_id: bookingId,
    p_type: type,
    p_inter: formData.get("inter_state") === "1",
    p_billing_name: String(formData.get("billing_name") || "").trim() || null,
    p_billing_gstin: String(formData.get("billing_gstin") || "").trim() || null,
    p_billing_address: String(formData.get("billing_address") || "").trim() || null,
    p_notes: String(formData.get("notes") || "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidateInvoicing(bookingId);
  redirect(`/invoices/${data}`);
}

export async function voidInvoice(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_invoice", {
    p_invoice_id: String(formData.get("invoice_id") || ""),
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };
  revalidateInvoicing(String(formData.get("booking_id") || "") || undefined);
  revalidatePath(`/invoices/${String(formData.get("invoice_id") || "")}`);
  return { ok: true };
}

export async function createCreditNote(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const amount = Number(formData.get("amount") || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a credit amount above zero" };

  const { error } = await supabase.rpc("create_credit_note", {
    p_invoice_id: String(formData.get("invoice_id") || ""),
    p_taxable: amount,
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };
  revalidateInvoicing(String(formData.get("booking_id") || "") || undefined);
  revalidatePath(`/invoices/${String(formData.get("invoice_id") || "")}`);
  return { ok: true };
}
