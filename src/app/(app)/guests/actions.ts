"use server";

import { requireUser, writeAudit } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { error: string };

const MAX_DOC_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

/**
 * Mobiles are compared for duplicates, so store them as the bare 10 digits
 * (spaces, dashes and a +91 / 0 prefix are dropped).
 */
function normalizeMobile(value: FormDataEntryValue | null) {
  let v = String(value || "").replace(/[\s\-().]/g, "");
  if (/^\+?91\d{10}$/.test(v)) v = v.replace(/^\+?91/, "");
  else if (/^0\d{10}$/.test(v)) v = v.slice(1);
  return v || null;
}

function normalizeEmail(value: FormDataEntryValue | null) {
  const v = String(value || "").trim().toLowerCase();
  return v || null;
}

function text(value: FormDataEntryValue | null) {
  return String(value || "").trim() || null;
}

function parseGuest(formData: FormData) {
  return {
    full_name: String(formData.get("full_name") || "").trim(),
    mobile: normalizeMobile(formData.get("mobile")),
    email: normalizeEmail(formData.get("email")),
    address: text(formData.get("address")),
    nationality: text(formData.get("nationality")) ?? "Indian",
    id_type: text(formData.get("id_type")),
    id_number: text(formData.get("id_number")),
    gstin: text(formData.get("gstin"))?.toUpperCase() ?? null,
    notes: text(formData.get("notes")),
  };
}

function validateGuest(p: ReturnType<typeof parseGuest>): string | null {
  if (!p.full_name) return "Name required";
  if (p.mobile && !/^\d{10}$/.test(p.mobile)) return "Mobile number must be exactly 10 digits";
  if (p.email && !/^\S+@\S+\.\S+$/.test(p.email)) return "Email looks invalid";
  if (p.gstin && !/^[0-9A-Z]{15}$/.test(p.gstin)) {
    return "GSTIN must be 15 letters/digits";
  }
  return null;
}

export type DuplicateGuest = {
  id: string;
  full_name: string;
  mobile: string | null;
  email: string | null;
};

export async function createGuest(
  formData: FormData,
): Promise<Result | { error: "duplicate"; duplicates: DuplicateGuest[] }> {
  await requireUser();
  const supabase = await createClient();
  const force = formData.get("force") === "1";
  const payload = parseGuest(formData);
  const invalid = validateGuest(payload);
  if (invalid) return { error: invalid };

  if (!force && (payload.mobile || payload.email)) {
    // Separate exact-match queries: values never go into a PostgREST filter string.
    const found = new Map<string, DuplicateGuest>();
    if (payload.mobile) {
      const { data } = await supabase
        .from("guests")
        .select("id, full_name, mobile, email")
        .eq("mobile", payload.mobile)
        .limit(5);
      data?.forEach((g) => found.set(g.id, g));
    }
    if (payload.email) {
      const { data } = await supabase
        .from("guests")
        .select("id, full_name, mobile, email")
        .eq("email", payload.email)
        .limit(5);
      data?.forEach((g) => found.set(g.id, g));
    }
    if (found.size > 0) {
      return { error: "duplicate", duplicates: [...found.values()] };
    }
  }

  const { data, error } = await supabase
    .from("guests")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { error: error.message };
  await writeAudit("create", "guests", data.id, payload);
  revalidatePath("/guests");
  redirect(`/guests/${data.id}`);
}

export async function updateGuest(formData: FormData): Promise<Result> {
  await requireUser();
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  const payload = parseGuest(formData);
  const invalid = validateGuest(payload);
  if (!id || invalid) return { error: invalid ?? "Missing guest" };
  const { error } = await supabase.from("guests").update(payload).eq("id", id);
  if (error) return { error: error.message };
  await writeAudit("update", "guests", id, payload);
  revalidatePath("/guests");
  revalidatePath(`/guests/${id}`);
  return { ok: true };
}

export async function uploadGuestDocument(formData: FormData): Promise<Result> {
  const session = await requireUser();
  const supabase = await createClient();
  const guestId = String(formData.get("guest_id") || "");
  const file = formData.get("file") as File | null;
  if (!guestId || !file || file.size === 0) return { error: "File required" };
  if (file.size > MAX_DOC_BYTES) return { error: "File is larger than 5 MB" };
  if (!ALLOWED_DOC_TYPES.includes(file.type)) {
    return { error: "Only PDF, JPG, PNG or WebP files are allowed" };
  }

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${guestId}/${Date.now()}-${safeName}`;
  const { error: upErr } = await supabase.storage
    .from("guest-documents")
    .upload(path, file, { contentType: file.type });
  if (upErr) return { error: upErr.message };

  const { data, error } = await supabase
    .from("guest_documents")
    .insert({
      guest_id: guestId,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      uploaded_by: session.user.id,
    })
    .select("id")
    .single();
  if (error) {
    // Don't leave an orphan file behind if the row could not be saved.
    await supabase.storage.from("guest-documents").remove([path]);
    return { error: error.message };
  }
  await writeAudit("upload", "guest_documents", data.id, { guestId, path });
  revalidatePath(`/guests/${guestId}`);
  return { ok: true };
}
