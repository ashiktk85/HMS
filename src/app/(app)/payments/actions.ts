"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { error: string };

function revalidateMoney(bookingId?: string) {
  revalidatePath("/payments");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
  revalidatePath("/bookings");
  if (bookingId) revalidatePath(`/bookings/${bookingId}`);
}

/** Records a payment (one transaction in the database). Redirects to the payment on success. */
export async function recordPayment(formData: FormData): Promise<{ error: string }> {
  await requireUser();
  const supabase = await createClient();
  const bookingId = String(formData.get("booking_id") || "");
  const amount = Number(formData.get("amount") || 0);
  const methodId = String(formData.get("method_id") || "");
  if (!bookingId) return { error: "Select a booking" };
  if (!methodId) return { error: "Choose a payment method" };
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter an amount above zero" };

  const { data, error } = await supabase.rpc("record_payment", {
    p_booking_id: bookingId,
    p_amount: amount,
    p_method_id: methodId,
    p_reference: String(formData.get("reference") || "").trim() || null,
    p_notes: String(formData.get("notes") || "").trim() || null,
  });
  if (error) return { error: error.message };

  revalidateMoney(bookingId);
  redirect(`/payments/${data}`);
}

export async function requestRefund(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const amount = Number(formData.get("amount") || 0);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Enter a refund amount above zero" };

  const { error } = await supabase.rpc("request_refund", {
    p_payment_id: String(formData.get("payment_id") || ""),
    p_amount: amount,
    p_method_id: String(formData.get("method_id") || ""),
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };

  revalidateMoney(String(formData.get("booking_id") || "") || undefined);
  revalidatePath(`/payments/${String(formData.get("payment_id") || "")}`);
  return { ok: true };
}

export async function decideRefund(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_refund", {
    p_refund_id: String(formData.get("refund_id") || ""),
    p_approve: formData.get("decision") === "approve",
    p_note: String(formData.get("note") || "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidateMoney();
  return { ok: true };
}

export async function voidPayment(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const paymentId = String(formData.get("payment_id") || "");
  const { error } = await supabase.rpc("void_payment", {
    p_payment_id: paymentId,
    p_reason: String(formData.get("reason") || ""),
  });
  if (error) return { error: error.message };
  revalidateMoney(String(formData.get("booking_id") || "") || undefined);
  revalidatePath(`/payments/${paymentId}`);
  return { ok: true };
}
