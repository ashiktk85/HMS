/**
 * Seed 3 staff users for Hotel Cloud HMS.
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 *
 * Usage: node --env-file=.env.local scripts/seed-users.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [
  {
    email: process.env.SEED_OWNER_EMAIL || "owner@hotel.local",
    password: process.env.SEED_OWNER_PASSWORD || "ChangeMe123!",
    full_name: "Hotel Owner",
    role: "owner",
  },
  {
    email: process.env.SEED_MANAGER_EMAIL || "manager@hotel.local",
    password: process.env.SEED_MANAGER_PASSWORD || "ChangeMe123!",
    full_name: "Front Office Manager",
    role: "manager",
  },
  {
    email: process.env.SEED_RECEPTION_EMAIL || "reception@hotel.local",
    password: process.env.SEED_RECEPTION_PASSWORD || "ChangeMe123!",
    full_name: "Reception Desk",
    role: "receptionist",
  },
];

for (const u of users) {
  let userId;
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
    app_metadata: { role: u.role },
  });
  if (error) {
    // Re-running the seed: reuse the existing login (its password is left unchanged).
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users.find((x) => x.email === u.email);
    if (!existing) {
      console.error(`Failed ${u.email}:`, error.message);
      continue;
    }
    userId = existing.id;
    await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...existing.app_metadata, role: u.role },
    });
  } else {
    userId = data.user.id;
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
  });
  if (profileError) {
    console.error(
      `Profile failed for ${u.email}: ${profileError.message}
` +
        "Run supabase/migrations/001_initial_schema.sql first, then re-run the seed.",
    );
    continue;
  }
  console.log(`${error ? "Updated" : "Created"} ${u.role}: ${u.email}`);
}

console.log("Done. Change default passwords after first login.");
