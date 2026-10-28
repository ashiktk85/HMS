"use server";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { error: string };

const text = (v: FormDataEntryValue | null) => String(v || "").trim() || null;

function revalidateRooms() {
  revalidatePath("/housekeeping");
  revalidatePath("/maintenance");
  revalidatePath("/rooms");
  revalidatePath("/bookings/calendar");
  revalidatePath("/dashboard");
}

// ---------- housekeeping ----------

export async function createHousekeepingTask(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_hk_task", {
    p_room_id: String(formData.get("room_id") || ""),
    p_priority: String(formData.get("priority") || "medium"),
    p_notes: text(formData.get("notes")),
    p_assigned_to: text(formData.get("assigned_to")),
  });
  if (error) return { error: error.message };
  revalidateRooms();
  return { ok: true };
}

export async function assignHousekeepingTask(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_hk_task", {
    p_task_id: String(formData.get("task_id") || ""),
    p_assigned_to: text(formData.get("assigned_to")),
    p_priority: text(formData.get("priority")),
  });
  if (error) return { error: error.message };
  revalidatePath("/housekeeping");
  return { ok: true };
}

export async function advanceHousekeepingTask(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_hk_task", {
    p_task_id: String(formData.get("task_id") || ""),
    p_status: String(formData.get("status") || ""),
    p_note: text(formData.get("note")),
  });
  if (error) return { error: error.message };
  revalidateRooms();
  return { ok: true };
}

// ---------- maintenance ----------

export async function reportMaintenance(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_maintenance", {
    p_room_id: text(formData.get("room_id")),
    p_title: String(formData.get("title") || ""),
    p_description: text(formData.get("description")),
    p_priority: String(formData.get("priority") || "medium"),
    p_assigned_to: text(formData.get("assigned_to")),
    p_block_room: formData.get("block_room") === "on",
  });
  if (error) return { error: error.message };
  revalidateRooms();
  return { ok: true };
}

export async function advanceMaintenance(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const costRaw = String(formData.get("cost") || "").trim();
  const cost = costRaw === "" ? null : Number(costRaw);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) return { error: "Cost must be 0 or more" };

  const { error } = await supabase.rpc("advance_maintenance", {
    p_request_id: String(formData.get("request_id") || ""),
    p_status: String(formData.get("status") || ""),
    p_assigned_to: text(formData.get("assigned_to")),
    p_cost: cost,
    p_note: text(formData.get("note")),
    p_expense_method_id:
      formData.get("record_expense") === "on" ? text(formData.get("expense_method_id")) : null,
  });
  if (error) return { error: error.message };
  revalidateRooms();
  revalidatePath("/expenses");
  revalidatePath("/accounts");
  return { ok: true };
}
