"use server";

import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

export async function getSessionProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  const role =
    (user.app_metadata?.role as AppRole | undefined) ||
    (profile?.role as AppRole | undefined) ||
    "receptionist";

  return {
    user,
    profile,
    role,
  };
}

export async function requireUser() {
  const session = await getSessionProfile();
  if (!session) {
    throw new Error("Not authenticated");
  }
  return session;
}

export async function writeAudit(
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("audit_logs").insert({
    actor_id: user?.id ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details: details ?? null,
  });
}
