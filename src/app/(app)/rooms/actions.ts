"use server";

import { requireUser, writeAudit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROOM_CATEGORIES, ROOM_STATUSES, type RoomCategory, type RoomStatus } from "@/lib/types";
import { revalidatePath } from "next/cache";

type Result = { ok: true } | { error: string };

function dbError(error: { code?: string; message: string }, what: string): Result {
  if (error.code === "23505") return { error: `${what} already exists` };
  return { error: error.message };
}

function parseRoomFields(formData: FormData) {
  return {
    room_number: String(formData.get("room_number") || "").trim(),
    category: String(formData.get("category") || "regular") as RoomCategory,
    base_rate: Number(formData.get("base_rate") || 0),
    max_occupancy: Number(formData.get("max_occupancy") || 2),
    floor: String(formData.get("floor") || "").trim() || null,
    notes: String(formData.get("notes") || "").trim() || null,
  };
}

function validateRoom(p: ReturnType<typeof parseRoomFields>): string | null {
  if (!p.room_number) return "Room number required";
  if (!ROOM_CATEGORIES.includes(p.category)) return "Choose regular or driver room";
  if (!Number.isFinite(p.base_rate) || p.base_rate < 0) return "Rate must be 0 or more";
  if (!Number.isInteger(p.max_occupancy) || p.max_occupancy < 1) {
    return "Max guests must be at least 1";
  }
  return null;
}

export async function createRoom(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const fields = parseRoomFields(formData);
  const invalid = validateRoom(fields);
  if (invalid) return { error: invalid };
  const payload = { ...fields, status: "available" as RoomStatus };
  const { data, error } = await supabase
    .from("rooms")
    .insert(payload)
    .select("id")
    .single();
  if (error) return dbError(error, `Room ${payload.room_number}`);
  await writeAudit("create", "rooms", data.id, payload);
  revalidatePath("/rooms");
  return { ok: true };
}

export async function updateRoom(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  const isActive = formData.get("is_active") === "on";
  const fields = parseRoomFields(formData);
  const invalid = validateRoom(fields);
  if (!id || invalid) return { error: invalid ?? "Missing room" };
  const payload = { ...fields, is_active: isActive };

  if (!isActive) {
    const { data: room } = await supabase
      .from("rooms")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (room && ["occupied", "reserved"].includes(room.status)) {
      return { error: `Cannot deactivate a room that is ${room.status}` };
    }
  }

  const { error } = await supabase.from("rooms").update(payload).eq("id", id);
  if (error) return dbError(error, `Room ${payload.room_number}`);
  await writeAudit("update", "rooms", id, payload);
  revalidatePath("/rooms");
  revalidatePath(`/rooms/${id}`);
  return { ok: true };
}

export async function updateRoomStatus(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("room_id") || "");
  const status = String(formData.get("status") || "") as RoomStatus;
  if (!id || !ROOM_STATUSES.includes(status)) return { error: "Invalid status" };
  // Notes are left untouched: the status form has no notes field.
  const { error } = await supabase.from("rooms").update({ status }).eq("id", id);
  if (error) return { error: error.message };
  await writeAudit("status_change", "rooms", id, { status });
  revalidatePath("/rooms");
  revalidatePath(`/rooms/${id}`);
  return { ok: true };
}
