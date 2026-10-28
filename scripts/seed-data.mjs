/**
 * Comprehensive database seeding script for Hotel Cloud HMS.
 * Seeds rich, realistic, interconnected data into EVERY table in the system.
 *
 * Usage: node --env-file=.env.local scripts/seed-data.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ALL_TABLES = [
  "profiles",
  "hotel_settings",
  "room_types",
  "rooms",
  "room_status_history",
  "guests",
  "guest_documents",
  "bookings",
  "booking_status_history",
  "check_ins",
  "check_outs",
  "service_items",
  "folio_charges",
  "accounts",
  "account_transactions",
  "payment_methods",
  "payments",
  "payment_allocations",
  "refunds",
  "invoice_counters",
  "invoices",
  "invoice_items",
  "tax_details",
  "credit_notes",
  "expense_categories",
  "expenses",
  "housekeeping_tasks",
  "maintenance_requests",
  "audit_logs",
];

async function getTableCounts() {
  const counts = {};
  for (const t of ALL_TABLES) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    counts[t] = error ? `ERR: ${error.message}` : (count ?? 0);
  }
  return counts;
}

async function main() {
  console.log("=================================================");
  console.log("      HOTEL CLOUD HMS - COMPLETE DATA SEEDER     ");
  console.log("=================================================\n");

  const todayStr = "2026-10-25";
  console.log(`Reference Date: ${todayStr} (Asia/Kolkata)`);

  // --------------------------------------------------------------------------
  // STEP 0: Clean existing transactional and dependent data
  // --------------------------------------------------------------------------
  console.log("\n[1/3] Cleaning existing operational data...");
  const tablesToClear = [
    "payment_allocations",
    "credit_notes",
    "tax_details",
    "invoice_items",
    "invoices",
    "refunds",
    "payments",
    "account_transactions",
    "folio_charges",
    "check_outs",
    "check_ins",
    "booking_status_history",
    "maintenance_requests",
    "housekeeping_tasks",
    "guest_documents",
    "bookings",
    "room_status_history",
    "rooms",
    "guests",
    "expenses",
  ];

  for (const t of tablesToClear) {
    const { error } = await admin.from(t).delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      console.warn(`  Warning clearing ${t}:`, error.message);
    }
  }

  // Clear invoice counters
  await admin.from("invoice_counters").delete().neq("series", "");

  // Reset account balances to 0 so triggers recalculate cleanly
  await admin.from("accounts").update({ balance: 0 }).neq("name", "");

  console.log("  Cleaned operational tables successfully.");

  // --------------------------------------------------------------------------
  // STEP 1: Staff Profiles & Auth Users (All 5 roles)
  // --------------------------------------------------------------------------
  console.log("\n[2/3] Seeding staff profiles...");
  const staffUsers = [
    {
      email: process.env.SEED_OWNER_EMAIL || "owner@hotel.local",
      password: process.env.SEED_OWNER_PASSWORD || "ChangeMe123!",
      full_name: "Vikramaditya Singhania",
      role: "owner",
    },
    {
      email: process.env.SEED_MANAGER_EMAIL || "manager@hotel.local",
      password: process.env.SEED_MANAGER_PASSWORD || "ChangeMe123!",
      full_name: "Rohit Deshmukh",
      role: "manager",
    },
    {
      email: process.env.SEED_RECEPTION_EMAIL || "reception@hotel.local",
      password: process.env.SEED_RECEPTION_PASSWORD || "ChangeMe123!",
      full_name: "Pooja Hegde",
      role: "receptionist",
    },
    {
      email: process.env.SEED_ACCOUNTANT_EMAIL || "accountant@hotel.local",
      password: process.env.SEED_ACCOUNTANT_PASSWORD || "ChangeMe123!",
      full_name: "Suresh Iyer",
      role: "accountant",
    },
    {
      email: process.env.SEED_HK_EMAIL || "housekeeping@hotel.local",
      password: process.env.SEED_HK_PASSWORD || "ChangeMe123!",
      full_name: "Manoj Naik",
      role: "housekeeping",
    },
  ];

  const profileMap = {}; // role -> profile_id

  for (const u of staffUsers) {
    let userId;
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.full_name },
      app_metadata: { role: u.role },
    });

    if (error) {
      const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const existing = list?.users.find((x) => x.email === u.email);
      if (existing) {
        userId = existing.id;
        await admin.auth.admin.updateUserById(userId, {
          user_metadata: { full_name: u.full_name },
          app_metadata: { ...existing.app_metadata, role: u.role },
        });
      } else {
        console.error(`  Failed user ${u.email}:`, error.message);
        continue;
      }
    } else {
      userId = data.user.id;
    }

    const { error: profErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: u.full_name,
      email: u.email,
      role: u.role,
      is_active: true,
    });

    if (profErr) {
      console.error(`  Profile error for ${u.email}:`, profErr.message);
    } else {
      profileMap[u.role] = userId;
    }
  }
  console.log(`  Seeded ${Object.keys(profileMap).length} staff profiles.`);

  // --------------------------------------------------------------------------
  // STEP 2: Hotel Settings
  // --------------------------------------------------------------------------
  console.log("  Configuring hotel settings...");
  const { data: existingSettings } = await admin.from("hotel_settings").select("id").limit(1);
  const settingsData = {
    hotel_name: "The Grand Azure Resort & Spa",
    address: "Beach Road, Calangute, Goa - 403516, India",
    phone: "+91 832 227 9900",
    email: "stay@grandazuregoa.com",
    gstin: "30AABCG1234F1Z8",
    currency_code: "INR",
    timezone: "Asia/Kolkata",
    cgst_rate: 6.0,
    sgst_rate: 6.0,
    igst_rate: 12.0,
    service_gst_rate: 18.0,
    gst_invoice_prefix: "GST",
    non_gst_invoice_prefix: "INV",
    credit_note_prefix: "CN",
    require_refund_approval: true,
    require_expense_approval: false,
  };

  if (existingSettings && existingSettings.length > 0) {
    await admin.from("hotel_settings").update(settingsData).eq("id", existingSettings[0].id);
  } else {
    await admin.from("hotel_settings").insert(settingsData);
  }

  // --------------------------------------------------------------------------
  // STEP 3: Room Types
  // --------------------------------------------------------------------------
  console.log("  Seeding room types...");
  const roomTypesToSeed = [
    {
      name: "Standard City Room",
      description: "Comfortable air-conditioned room with king-size bed, workstation, and smart LED TV.",
      base_rate: 2800,
      max_occupancy: 2,
      is_active: true,
    },
    {
      name: "Deluxe Sea View",
      description: "Spacious luxury room with a private balcony overlooking the Arabian Sea.",
      base_rate: 4800,
      max_occupancy: 2,
      is_active: true,
    },
    {
      name: "Executive Suite",
      description: "Premium suite with separate living room, executive work desk, and jacuzzi bath.",
      base_rate: 8500,
      max_occupancy: 3,
      is_active: true,
    },
    {
      name: "Family Pool Villa",
      description: "Private 2-bedroom villa with plunge pool, sundeck, and kitchen pantry.",
      base_rate: 14500,
      max_occupancy: 4,
      is_active: true,
    },
    {
      name: "Presidential Suite",
      description: "Top-floor penthouse suite featuring panoramic 360-degree views, dining hall, and dedicated butler.",
      base_rate: 26000,
      max_occupancy: 4,
      is_active: true,
    },
  ];

  for (const rt of roomTypesToSeed) {
    await admin.from("room_types").upsert(rt, { onConflict: "name" });
  }

  const { data: roomTypes } = await admin.from("room_types").select("id, name, base_rate");
  const rtMap = Object.fromEntries(roomTypes.map((rt) => [rt.name, rt]));

  // --------------------------------------------------------------------------
  // STEP 4: Rooms & Room Status History
  // --------------------------------------------------------------------------
  console.log("  Seeding rooms across floors...");
  const roomsToSeed = [
    { room_number: "101", room_type_id: rtMap["Standard City Room"]?.id, floor: "1", status: "available" },
    { room_number: "102", room_type_id: rtMap["Standard City Room"]?.id, floor: "1", status: "occupied" },
    { room_number: "103", room_type_id: rtMap["Standard City Room"]?.id, floor: "1", status: "dirty" },
    { room_number: "104", room_type_id: rtMap["Standard City Room"]?.id, floor: "1", status: "cleaning" },
    { room_number: "201", room_type_id: rtMap["Deluxe Sea View"]?.id, floor: "2", status: "occupied" },
    { room_number: "202", room_type_id: rtMap["Deluxe Sea View"]?.id, floor: "2", status: "reserved" },
    { room_number: "203", room_type_id: rtMap["Deluxe Sea View"]?.id, floor: "2", status: "inspection" },
    { room_number: "204", room_type_id: rtMap["Deluxe Sea View"]?.id, floor: "2", status: "available" },
    { room_number: "301", room_type_id: rtMap["Executive Suite"]?.id, floor: "3", status: "occupied" },
    { room_number: "302", room_type_id: rtMap["Executive Suite"]?.id, floor: "3", status: "maintenance" },
    { room_number: "401", room_type_id: rtMap["Family Pool Villa"]?.id, floor: "4", status: "available" },
    { room_number: "501", room_type_id: rtMap["Presidential Suite"]?.id, floor: "5", status: "blocked" },
  ];

  // Rooms are now regular (customer) or driver rooms with their own rate; the old type only supplies the rate.
  const typeById = Object.fromEntries(roomTypes.map((rt) => [rt.id, rt]));
  for (const r of roomsToSeed) {
    r.base_rate = typeById[r.room_type_id]?.base_rate ?? 0;
    r.max_occupancy = 2;
    r.category = ["401", "501"].includes(r.room_number) ? "driver" : "regular";
  }

  const { data: seededRooms, error: roomsErr } = await admin.from("rooms").insert(roomsToSeed).select();
  if (roomsErr) console.error("  Rooms error:", roomsErr.message);
  const roomMap = Object.fromEntries((seededRooms || []).map((r) => [r.room_number, r]));

  // Add historical transitions in room_status_history for realistic audit
  if (roomMap["103"]) {
    await admin.from("room_status_history").insert([
      {
        room_id: roomMap["103"].id,
        from_status: "occupied",
        to_status: "dirty",
        notes: "Guest checked out at 09:30 AM",
        changed_by: profileMap["receptionist"],
        created_at: `${todayStr}T04:00:00+00:00`,
      },
    ]);
  }
  if (roomMap["104"]) {
    await admin.from("room_status_history").insert([
      {
        room_id: roomMap["104"].id,
        from_status: "dirty",
        to_status: "cleaning",
        notes: "Housekeeper assigned",
        changed_by: profileMap["housekeeping"],
        created_at: `${todayStr}T05:30:00+00:00`,
      },
    ]);
  }

  // --------------------------------------------------------------------------
  // STEP 5: Guests & Guest Documents
  // --------------------------------------------------------------------------
  console.log("  Seeding guests and documents...");
  const guestsToSeed = [
    {
      full_name: "Aditya Roy Verma",
      mobile: "+91 98201 54321",
      email: "aditya.verma@mumbaicorp.in",
      address: "Flat 1402, Altamount Road, Mumbai, Maharashtra - 400026",
      nationality: "Indian",
      id_type: "Aadhaar",
      id_number: "4521 8899 1234",
      gstin: "27AABCV1234M1Z5",
      notes: "Frequent business traveler, prefers upper floor sea view.",
    },
    {
      full_name: "Priya Sundaram Nair",
      mobile: "+91 98450 78912",
      email: "priya.nair@techblr.io",
      address: "Villa 22, Palm Meadows, Whitefield, Bengaluru, Karnataka - 560066",
      nationality: "Indian",
      id_type: "Passport",
      id_number: "Z5541920",
      notes: "Allergic to feather pillows; requested hypoallergenic linen.",
    },
    {
      full_name: "Rajeshwar Sharma",
      mobile: "+91 98110 33445",
      email: "rajeshwar@delhiconsult.com",
      address: "C-45, Greater Kailash Part 1, New Delhi - 110048",
      nationality: "Indian",
      id_type: "Driving License",
      id_number: "DL0420180098765",
      gstin: "07AAACR9988D1Z2",
      notes: "Corporate client with Bharat Corp Consulting.",
    },
    {
      full_name: "Ananya Deshmukh",
      mobile: "+91 97654 11223",
      email: "ananya.deshmukh@gmail.com",
      address: "12, Law College Road, Erandwane, Pune, Maharashtra - 411004",
      nationality: "Indian",
      id_type: "Aadhaar",
      id_number: "7788 9900 1122",
      notes: "Honeymoon couple, complimentary fruit basket provided.",
    },
    {
      full_name: "Michael Robert Anderson",
      mobile: "+44 7911 234567",
      email: "m.anderson@londonlegal.co.uk",
      address: "45 Kensington High Street, London, W8 5ED, United Kingdom",
      nationality: "British",
      id_type: "Passport",
      id_number: "GB99238471",
      notes: "UK tourist visiting Goa for 2 weeks holiday.",
    },
    {
      full_name: "Amit Kantilal Patel",
      mobile: "+91 98250 44556",
      email: "amit.patel@gujarattextiles.biz",
      address: "Plot 89, Bodakdev, Ahmedabad, Gujarat - 380054",
      nationality: "Indian",
      id_type: "Aadhaar",
      id_number: "3322 1144 5566",
      gstin: "24AAACP4455G1Z9",
      notes: "VIP guest, requires airport pickup and drop.",
    },
    {
      full_name: "Dr. Sneha Reddy",
      mobile: "+91 98490 66778",
      email: "dr.sneha@apollohealth.org",
      address: "Road No 36, Jubilee Hills, Hyderabad, Telangana - 500033",
      nationality: "Indian",
      id_type: "Aadhaar",
      id_number: "6655 4433 2211",
      notes: "Attending annual medical conference in Goa.",
    },
    {
      full_name: "Rohan Sengupta",
      mobile: "+91 98300 77889",
      email: "rohan.sengupta@kolkatamedia.in",
      address: "7B, Ballygunge Circular Road, Kolkata, West Bengal - 700019",
      nationality: "Indian",
      id_type: "Voter ID",
      id_number: "WBK0912445",
      notes: "Family vacation with 2 children.",
    },
    {
      full_name: "Sunita Raul Rao",
      mobile: "+91 98221 88990",
      email: "sunita.rao@goahotels.org",
      address: "Casa Bella, Miramar Beach, Panaji, Goa - 403001",
      nationality: "Indian",
      id_type: "Aadhaar",
      id_number: "9911 2233 4455",
      gstin: "30AAACR3322P1Z3",
      notes: "Local Goa vendor partner.",
    },
    {
      full_name: "Karanveer Oberoi",
      mobile: "+91 98765 12345",
      email: "karan.oberoi@punjabfarms.com",
      address: "Sector 9-D, Chandigarh - 160009",
      nationality: "Indian",
      id_type: "Driving License",
      id_number: "CH0120190033221",
      notes: "Requested late check-out on final day.",
    },
  ];

  const { data: seededGuests, error: guestsErr } = await admin.from("guests").insert(guestsToSeed).select();
  if (guestsErr) console.error("  Guests error:", guestsErr.message);
  const guestMap = Object.fromEntries((seededGuests || []).map((g) => [g.full_name, g]));

  // Guest Documents
  if (guestMap["Aditya Roy Verma"]) {
    await admin.from("guest_documents").insert([
      {
        guest_id: guestMap["Aditya Roy Verma"].id,
        file_path: "guest-documents/aadhaar_aditya_verma.pdf",
        file_name: "Aadhaar_Aditya_Verma.pdf",
        mime_type: "application/pdf",
        uploaded_by: profileMap["receptionist"],
      },
    ]);
  }
  if (guestMap["Priya Sundaram Nair"]) {
    await admin.from("guest_documents").insert([
      {
        guest_id: guestMap["Priya Sundaram Nair"].id,
        file_path: "guest-documents/passport_priya_nair.jpg",
        file_name: "Passport_Priya_Nair.jpg",
        mime_type: "image/jpeg",
        uploaded_by: profileMap["receptionist"],
      },
    ]);
  }
  if (guestMap["Michael Robert Anderson"]) {
    await admin.from("guest_documents").insert([
      {
        guest_id: guestMap["Michael Robert Anderson"].id,
        file_path: "guest-documents/passport_michael_anderson.pdf",
        file_name: "UK_Passport_Anderson.pdf",
        mime_type: "application/pdf",
        uploaded_by: profileMap["receptionist"],
      },
    ]);
  }
  if (guestMap["Amit Kantilal Patel"]) {
    await admin.from("guest_documents").insert([
      {
        guest_id: guestMap["Amit Kantilal Patel"].id,
        file_path: "guest-documents/aadhaar_amit_patel.pdf",
        file_name: "Aadhaar_Amit_Patel.pdf",
        mime_type: "application/pdf",
        uploaded_by: profileMap["receptionist"],
      },
    ]);
  }

  // --------------------------------------------------------------------------
  // STEP 6: Service Items
  // --------------------------------------------------------------------------
  console.log("  Ensuring service items...");
  const serviceItemsToEnsure = [
    { name: "Extra Bed", default_amount: 500, is_active: true },
    { name: "Laundry", default_amount: 250, is_active: true },
    { name: "Mini Bar", default_amount: 350, is_active: true },
    { name: "Room Service", default_amount: 300, is_active: true },
    { name: "Early Check-in", default_amount: 600, is_active: true },
    { name: "Late Check-out", default_amount: 600, is_active: true },
    { name: "Airport Shuttle", default_amount: 1400, is_active: true },
    { name: "Ayurvedic Spa Massage", default_amount: 2500, is_active: true },
  ];

  for (const item of serviceItemsToEnsure) {
    await admin.from("service_items").upsert(item, { onConflict: "name" });
  }

  const { data: serviceItems } = await admin.from("service_items").select("id, name, default_amount");
  const svcMap = Object.fromEntries(serviceItems.map((s) => [s.name, s]));

  // --------------------------------------------------------------------------
  // STEP 7: Bookings & Booking Status History
  // --------------------------------------------------------------------------
  console.log("  Seeding bookings across all statuses...");
  // Reference date: 2026-10-25
  const bookingsToSeed = [
    // 1. Past completed stay (Checked-out)
    {
      booking_code: "BK261018ADITYA",
      guest_id: guestMap["Aditya Roy Verma"]?.id,
      room_id: roomMap["101"]?.id,
      source: "direct",
      status: "checked_out",
      check_in_date: "2026-10-18",
      check_out_date: "2026-10-22",
      adults: 2,
      children: 0,
      room_rate: 2800,
      discount_amount: 500,
      extra_bed_charge: 500,
      additional_charges: 0,
      notes: "Corporate stay with early morning breakfast requested.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-15T10:00:00+00:00",
    },
    // 2. Past completed deluxe stay (Checked-out)
    {
      booking_code: "BK261019RAJESH",
      guest_id: guestMap["Rajeshwar Sharma"]?.id,
      room_id: roomMap["201"]?.id,
      source: "phone",
      status: "checked_out",
      check_in_date: "2026-10-19",
      check_out_date: "2026-10-23",
      adults: 2,
      children: 1,
      room_rate: 4800,
      discount_amount: 1000,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Client requested quiet corner room.",
      created_by: profileMap["manager"],
      created_at: "2026-10-16T14:30:00+00:00",
    },
    // 3. Checked-in stay departing TODAY (2026-10-25)
    {
      booking_code: "BK261022ANANYA",
      guest_id: guestMap["Ananya Deshmukh"]?.id,
      room_id: roomMap["102"]?.id,
      source: "walk_in",
      status: "checked_in",
      check_in_date: "2026-10-22",
      check_out_date: "2026-10-25",
      adults: 2,
      children: 0,
      room_rate: 2800,
      discount_amount: 0,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Check-out scheduled for today afternoon.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-22T10:15:00+00:00",
    },
    // 4. Currently In-House Stay (Checked-in)
    {
      booking_code: "BK261024PRIYAA",
      guest_id: guestMap["Priya Sundaram Nair"]?.id,
      room_id: roomMap["201"]?.id,
      source: "direct",
      status: "checked_in",
      check_in_date: "2026-10-24",
      check_out_date: "2026-10-28",
      adults: 2,
      children: 0,
      room_rate: 4800,
      discount_amount: 0,
      extra_bed_charge: 500,
      additional_charges: 0,
      notes: "Anniversary celebration; requested cake delivery.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-20T08:00:00+00:00",
    },
    // 5. Currently In-House Executive Suite (Checked-in)
    {
      booking_code: "BK261023AMITPA",
      guest_id: guestMap["Amit Kantilal Patel"]?.id,
      room_id: roomMap["301"]?.id,
      source: "direct",
      status: "checked_in",
      check_in_date: "2026-10-23",
      check_out_date: "2026-10-27",
      adults: 2,
      children: 1,
      room_rate: 8500,
      discount_amount: 1500,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "VIP guest, high priority housekeeping.",
      created_by: profileMap["manager"],
      created_at: "2026-10-21T11:45:00+00:00",
    },
    // 6. Confirmed arrival arriving TODAY (2026-10-25)
    {
      booking_code: "BK261025MICHEL",
      guest_id: guestMap["Michael Robert Anderson"]?.id,
      room_id: roomMap["202"]?.id,
      source: "direct",
      status: "confirmed",
      check_in_date: "2026-10-25",
      check_out_date: "2026-10-29",
      adults: 1,
      children: 0,
      room_rate: 4800,
      discount_amount: 0,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Arriving on flight BA119 at Goa Dabolim Airport ~ 15:00.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-22T09:00:00+00:00",
    },
    // 7. Confirmed upcoming Villa booking
    {
      booking_code: "BK261029SNEHAR",
      guest_id: guestMap["Dr. Sneha Reddy"]?.id,
      room_id: roomMap["401"]?.id,
      source: "whatsapp",
      status: "confirmed",
      check_in_date: "2026-10-29",
      check_out_date: "2026-11-03",
      adults: 4,
      children: 1,
      room_rate: 14500,
      discount_amount: 2500,
      extra_bed_charge: 1000,
      additional_charges: 0,
      notes: "Family retreat with poolside BBQ reservation.",
      created_by: profileMap["manager"],
      created_at: "2026-10-23T16:20:00+00:00",
    },
    // 8. Tentative reservation on HOLD
    {
      booking_code: "BK261030ROHANS",
      guest_id: guestMap["Rohan Sengupta"]?.id,
      room_id: roomMap["204"]?.id,
      source: "phone",
      status: "hold",
      check_in_date: "2026-10-30",
      check_out_date: "2026-11-02",
      adults: 2,
      children: 2,
      room_rate: 4800,
      discount_amount: 0,
      extra_bed_charge: 500,
      additional_charges: 0,
      notes: "Awaiting flight confirmation from Kolkata.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-24T12:00:00+00:00",
    },
    // 9. Early Enquiry
    {
      booking_code: "BK261110SUNITA",
      guest_id: guestMap["Sunita Raul Rao"]?.id,
      room_id: roomMap["401"]?.id,
      source: "direct",
      status: "enquiry",
      check_in_date: "2026-11-10",
      check_out_date: "2026-11-14",
      adults: 2,
      children: 0,
      room_rate: 14500,
      discount_amount: 0,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Inquired about wedding anniversary villa package.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-25T10:00:00+00:00",
    },
    // 10. Cancelled booking
    {
      booking_code: "BK261105KARANO",
      guest_id: guestMap["Karanveer Oberoi"]?.id,
      room_id: roomMap["101"]?.id,
      source: "phone",
      status: "cancelled",
      check_in_date: "2026-11-05",
      check_out_date: "2026-11-08",
      adults: 2,
      children: 0,
      room_rate: 2800,
      discount_amount: 0,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Cancelled due to personal emergency.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-21T15:00:00+00:00",
    },
    // 11. No-Show booking
    {
      booking_code: "BK261020NOSHOW",
      guest_id: guestMap["Aditya Roy Verma"]?.id,
      room_id: roomMap["103"]?.id,
      source: "walk_in",
      status: "no_show",
      check_in_date: "2026-10-20",
      check_out_date: "2026-10-22",
      adults: 1,
      children: 0,
      room_rate: 2800,
      discount_amount: 0,
      extra_bed_charge: 0,
      additional_charges: 0,
      notes: "Guest failed to arrive; 1-night retention charged.",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-19T18:00:00+00:00",
    },
  ];

  const { data: seededBookings, error: bookingsErr } = await admin.from("bookings").insert(bookingsToSeed).select();
  if (bookingsErr) console.error("  Bookings error:", bookingsErr.message);
  const bookingMap = Object.fromEntries((seededBookings || []).map((b) => [b.booking_code, b]));

  // Add historical transitions in booking_status_history
  if (bookingMap["BK261018ADITYA"]) {
    await admin.from("booking_status_history").insert([
      {
        booking_id: bookingMap["BK261018ADITYA"].id,
        from_status: "confirmed",
        to_status: "checked_in",
        notes: "Guest arrived at front desk, room key handed over.",
        changed_by: profileMap["receptionist"],
        created_at: "2026-10-18T14:15:00+00:00",
      },
      {
        booking_id: bookingMap["BK261018ADITYA"].id,
        from_status: "checked_in",
        to_status: "checked_out",
        notes: "Final bill settled via card.",
        changed_by: profileMap["receptionist"],
        created_at: "2026-10-22T11:00:00+00:00",
      },
    ]);
  }

  // --------------------------------------------------------------------------
  // STEP 8: Check-Ins & Check-Outs
  // --------------------------------------------------------------------------
  console.log("  Recording check-in and check-out logs...");
  const checkInsToSeed = [
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      room_id: roomMap["101"]?.id,
      id_verified: true,
      additional_guests: 1,
      notes: "ID verified (Aadhaar). Welcome drink served.",
      checked_in_by: profileMap["receptionist"],
      checked_in_at: "2026-10-18T14:15:00+05:30",
    },
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      room_id: roomMap["201"]?.id,
      id_verified: true,
      additional_guests: 1,
      notes: "ID verified (DL). Luggage assisted by bell desk.",
      checked_in_by: profileMap["receptionist"],
      checked_in_at: "2026-10-19T13:40:00+05:30",
    },
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      room_id: roomMap["102"]?.id,
      id_verified: true,
      additional_guests: 1,
      notes: "ID verified (Aadhaar). Late checkout requested.",
      checked_in_by: profileMap["receptionist"],
      checked_in_at: "2026-10-22T15:20:00+05:30",
    },
    {
      booking_id: bookingMap["BK261024PRIYAA"]?.id,
      room_id: roomMap["201"]?.id,
      id_verified: true,
      additional_guests: 1,
      notes: "ID verified (Passport).",
      checked_in_by: profileMap["receptionist"],
      checked_in_at: "2026-10-24T12:30:00+05:30",
    },
    {
      booking_id: bookingMap["BK261023AMITPA"]?.id,
      room_id: roomMap["301"]?.id,
      id_verified: true,
      additional_guests: 1,
      notes: "VIP check-in expedited.",
      checked_in_by: profileMap["manager"],
      checked_in_at: "2026-10-23T16:00:00+05:30",
    },
  ];

  for (const ci of checkInsToSeed) {
    if (ci.booking_id && ci.room_id) {
      await admin.from("check_ins").insert(ci);
    }
  }

  const checkOutsToSeed = [
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      final_bill: 12544,
      outstanding: 0,
      notes: "Guest very satisfied with housekeeping and dining.",
      checked_out_by: profileMap["receptionist"],
      checked_out_at: "2026-10-22T11:00:00+05:30",
    },
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      final_bill: 20384,
      outstanding: 0,
      notes: "Bill settled via corporate credit card.",
      checked_out_by: profileMap["receptionist"],
      checked_out_at: "2026-10-23T10:30:00+05:30",
    },
  ];

  for (const co of checkOutsToSeed) {
    if (co.booking_id) {
      await admin.from("check_outs").insert(co);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 9: Folio Charges
  // --------------------------------------------------------------------------
  console.log("  Seeding folio room charges...");
  const folioToSeed = [
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      service_item_id: svcMap["Room Service"]?.id,
      description: "Dinner Room Service (Biryani & Mocktails)",
      quantity: 1,
      unit_amount: 650,
      amount: 650,
      voided: false,
      created_by: profileMap["receptionist"],
      created_at: "2026-10-19T20:30:00+00:00",
    },
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      service_item_id: svcMap["Laundry"]?.id,
      description: "Express Laundry - 4 garments",
      quantity: 1,
      unit_amount: 400,
      amount: 400,
      voided: false,
      created_by: profileMap["receptionist"],
      created_at: "2026-10-20T10:00:00+00:00",
    },
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      service_item_id: svcMap["Mini Bar"]?.id,
      description: "Mini Bar Consumables (Chocolates & Soft Drinks)",
      quantity: 1,
      unit_amount: 600,
      amount: 600,
      voided: false,
      created_by: profileMap["receptionist"],
      created_at: "2026-10-20T18:00:00+00:00",
    },
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      service_item_id: svcMap["Room Service"]?.id,
      description: "Breakfast in Bed - Continental spread",
      quantity: 1,
      unit_amount: 450,
      amount: 450,
      voided: false,
      created_by: profileMap["receptionist"],
      created_at: "2026-10-23T08:30:00+00:00",
    },
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      service_item_id: svcMap["Mini Bar"]?.id,
      description: "Mini Bar Soda Cans (Disputed by guest)",
      quantity: 1,
      unit_amount: 350,
      amount: 350,
      voided: true,
      void_reason: "Item was unopened; guest disputed charge during inspection",
      voided_at: `${todayStr}T09:00:00+00:00`,
      voided_by: profileMap["receptionist"],
      created_by: profileMap["receptionist"],
      created_at: "2026-10-24T18:00:00+00:00",
    },
    {
      booking_id: bookingMap["BK261024PRIYAA"]?.id,
      service_item_id: svcMap["Ayurvedic Spa Massage"]?.id,
      description: "Ayurvedic Spa Massage - Couple session",
      quantity: 1,
      unit_amount: 2500,
      amount: 2500,
      voided: false,
      created_by: profileMap["receptionist"],
      created_at: `${todayStr}T06:00:00+00:00`,
    },
    {
      booking_id: bookingMap["BK261023AMITPA"]?.id,
      service_item_id: svcMap["Airport Shuttle"]?.id,
      description: "Airport Luxury Sedan Transfer (Dabolim)",
      quantity: 1,
      unit_amount: 1400,
      amount: 1400,
      voided: false,
      created_by: profileMap["manager"],
      created_at: "2026-10-23T15:00:00+00:00",
    },
  ];

  for (const f of folioToSeed) {
    if (f.booking_id) {
      await admin.from("folio_charges").insert(f);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 10: Accounts & Payment Methods
  // --------------------------------------------------------------------------
  console.log("  Verifying accounts and payment methods...");
  const { data: accounts } = await admin.from("accounts").select("id, name, kind");
  const accMap = Object.fromEntries(accounts.map((a) => [a.kind, a]));

  const { data: payMethods } = await admin.from("payment_methods").select("id, name, account_id");
  const pmMap = Object.fromEntries(payMethods.map((m) => [m.name, m]));

  // --------------------------------------------------------------------------
  // STEP 11: Payments
  // --------------------------------------------------------------------------
  console.log("  Seeding booking payments...");
  const paymentsToSeed = [
    // BK-PAST-01: Advance payment
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      amount: 5000,
      method: "UPI",
      reference: "UPI/261018/887712",
      notes: "Advance deposit received via GooglePay",
      account_id: accMap["upi"]?.id,
      receipt_no: "RC-000001",
      received_at: "2026-10-15T10:15:00+05:30",
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // BK-PAST-01: Check-out settlement payment
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      amount: 7544,
      method: "Credit Card",
      reference: "CC-SWIPE-991244",
      notes: "Settled upon check-out",
      account_id: accMap["card"]?.id,
      receipt_no: "RC-000002",
      received_at: "2026-10-22T10:55:00+05:30",
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // BK-PAST-02: Bank transfer payment
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      amount: 10000,
      method: "Bank Transfer",
      reference: "NEFT-HDFC-9923847",
      notes: "Corporate advance NEFT",
      account_id: accMap["bank"]?.id,
      receipt_no: "RC-000003",
      received_at: "2026-10-16T15:00:00+05:30",
      received_by: profileMap["manager"],
      voided: false,
    },
    // BK-PAST-02: Settlement payment
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      amount: 8704,
      method: "Credit Card",
      reference: "AMEX-AUTH-441199",
      notes: "Final settlement card payment",
      account_id: accMap["card"]?.id,
      receipt_no: "RC-000004",
      received_at: "2026-10-23T10:25:00+05:30",
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // BK-DEP-01: Advance payment
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      amount: 4000,
      method: "Cash",
      reference: "CASH-REC-1022",
      notes: "Cash advance handed at front desk",
      account_id: accMap["cash"]?.id,
      receipt_no: "RC-000005",
      received_at: "2026-10-22T15:25:00+05:30",
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // BK-INH-01: In-house advance
    {
      booking_id: bookingMap["BK261024PRIYAA"]?.id,
      amount: 10000,
      method: "UPI",
      reference: "UPI/PAYTM/776655",
      notes: "Online UPI payment",
      account_id: accMap["upi"]?.id,
      receipt_no: "RC-000006",
      received_at: "2026-10-24T12:35:00+05:30",
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // BK-INH-02: In-house Executive Suite advance
    {
      booking_id: bookingMap["BK261023AMITPA"]?.id,
      amount: 15000,
      method: "Bank Transfer",
      reference: "RTGS-ICICI-443322",
      notes: "RTGS business transfer",
      account_id: accMap["bank"]?.id,
      receipt_no: "RC-000007",
      received_at: "2026-10-23T16:10:00+05:30",
      received_by: profileMap["manager"],
      voided: false,
    },
    // BK-ARR-01: Confirmed arrival deposit received TODAY
    {
      booking_id: bookingMap["BK261025MICHEL"]?.id,
      amount: 5000,
      method: "Credit Card",
      reference: "STRIPE-INTL-9988",
      notes: "Online advance received today",
      account_id: accMap["card"]?.id,
      receipt_no: "RC-000008",
      received_at: `${todayStr}T09:30:00+05:30`,
      received_by: profileMap["receptionist"],
      voided: false,
    },
    // Voided payment example
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      amount: 2000,
      method: "Credit Card",
      reference: "POS-ERR-1102",
      notes: "Card machine duplicate charge",
      account_id: accMap["card"]?.id,
      receipt_no: "RC-000009",
      received_at: "2026-10-24T11:00:00+05:30",
      received_by: profileMap["receptionist"],
      voided: true,
      void_reason: "Swipe terminal communication error created duplicate entry",
      voided_at: "2026-10-24T11:05:00+05:30",
      voided_by: profileMap["manager"],
    },
  ];

  const { data: seededPayments, error: payErr } = await admin.from("payments").insert(paymentsToSeed).select();
  if (payErr) console.error("  Payments error:", payErr.message);
  const payMap = Object.fromEntries((seededPayments || []).map((p) => [p.receipt_no, p]));

  // --------------------------------------------------------------------------
  // STEP 12: Refunds
  // --------------------------------------------------------------------------
  console.log("  Seeding refund records (approved, pending, rejected)...");
  const refundsToSeed = [
    // 1. Approved refund (triggers ledger debit automatically)
    {
      payment_id: payMap["RC-000001"]?.id,
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      account_id: accMap["upi"]?.id,
      amount: 800,
      method: "UPI",
      reason: "Concession refund for laundry service delay during stay",
      approval_status: "approved",
      approved_by: profileMap["manager"],
      created_by: profileMap["receptionist"],
      created_at: "2026-10-22T11:30:00+05:30",
      decided_at: `${todayStr}T09:00:00+05:30`,
      decision_note: "Approved by Front Office Manager as goodwill courtesy.",
    },
    // 2. Pending refund awaiting approval
    {
      payment_id: payMap["RC-000005"]?.id,
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      account_id: accMap["cash"]?.id,
      amount: 500,
      method: "Cash",
      reason: "Disputed early check-in charge reimbursement",
      approval_status: "pending",
      created_by: profileMap["receptionist"],
      created_at: `${todayStr}T10:15:00+05:30`,
    },
    // 3. Rejected refund
    {
      payment_id: payMap["RC-000008"]?.id,
      booking_id: bookingMap["BK261025MICHEL"]?.id,
      account_id: accMap["card"]?.id,
      amount: 1500,
      method: "Credit Card",
      reason: "Customer requested partial advance refund within 24h",
      approval_status: "rejected",
      approved_by: profileMap["manager"],
      created_by: profileMap["receptionist"],
      created_at: `${todayStr}T09:45:00+05:30`,
      decided_at: `${todayStr}T10:00:00+05:30`,
      decision_note: "Rejected as per standard non-refundable reservation policy.",
    },
  ];

  for (const r of refundsToSeed) {
    if (r.payment_id && r.booking_id) {
      await admin.from("refunds").insert(r);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 13: Invoices, Invoice Items, Tax Details & Counters
  // --------------------------------------------------------------------------
  console.log("  Seeding invoices and fiscal tax records...");
  // Counters for 26-27
  await admin.from("invoice_counters").upsert([
    { series: "gst", fiscal_year: "26-27", last_no: 3 },
    { series: "non_gst", fiscal_year: "26-27", last_no: 2 },
  ]);

  const invoicesToSeed = [
    // 1. GST Invoice (Intra-state, Goa to Maharashtra corporate with valid GSTIN)
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      guest_id: guestMap["Aditya Roy Verma"]?.id,
      invoice_type: "gst",
      invoice_number: "GST/26-27/00001",
      status: "issued",
      customer_gstin: "27AABCV1234M1Z5",
      hotel_gstin: "30AABCG1234F1Z8",
      taxable_value: 11200.0,
      cgst_amount: 672.0,
      sgst_amount: 672.0,
      igst_amount: 0.0,
      total_amount: 12544.0,
      place_of_supply: "Goa (30)",
      is_inter_state: false,
      notes: "Tax Invoice - Intra-state B2B",
      billing_name: "Aditya Roy Verma",
      billing_address: "Flat 1402, Altamount Road, Mumbai, Maharashtra - 400026",
      fiscal_year: "26-27",
      issued_by: profileMap["receptionist"],
      issued_at: "2026-10-22T10:50:00+05:30",
    },
    // 2. GST Invoice (Inter-state, with Credit Note)
    {
      booking_id: bookingMap["BK261019RAJESH"]?.id,
      guest_id: guestMap["Rajeshwar Sharma"]?.id,
      invoice_type: "gst",
      invoice_number: "GST/26-27/00002",
      status: "credited",
      customer_gstin: "07AAACR9988D1Z2",
      hotel_gstin: "30AABCG1234F1Z8",
      taxable_value: 18200.0,
      cgst_amount: 0.0,
      sgst_amount: 0.0,
      igst_amount: 2184.0,
      total_amount: 20384.0,
      place_of_supply: "Delhi (07)",
      is_inter_state: true,
      notes: "Tax Invoice - Inter-state B2B",
      billing_name: "Rajeshwar Sharma",
      billing_address: "C-45, Greater Kailash Part 1, New Delhi - 110048",
      fiscal_year: "26-27",
      issued_by: profileMap["manager"],
      issued_at: "2026-10-23T10:20:00+05:30",
    },
    // 3. Non-GST Retail Invoice
    {
      booking_id: bookingMap["BK261022ANANYA"]?.id,
      guest_id: guestMap["Ananya Deshmukh"]?.id,
      invoice_type: "non_gst",
      invoice_number: "INV/26-27/00001",
      status: "issued",
      taxable_value: 8850.0,
      cgst_amount: 0.0,
      sgst_amount: 0.0,
      igst_amount: 0.0,
      total_amount: 8850.0,
      is_inter_state: false,
      notes: "Bill of Supply - Non-GST Retail",
      billing_name: "Ananya Deshmukh",
      billing_address: "12, Law College Road, Erandwane, Pune, Maharashtra",
      fiscal_year: "26-27",
      issued_by: profileMap["receptionist"],
      issued_at: `${todayStr}T08:00:00+05:30`,
    },
    // 4. Voided Invoice example
    {
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      guest_id: guestMap["Aditya Roy Verma"]?.id,
      invoice_type: "gst",
      invoice_number: "GST/26-27/00003",
      status: "voided",
      customer_gstin: "27AABCV1234M1Z5",
      hotel_gstin: "30AABCG1234F1Z8",
      taxable_value: 11200.0,
      cgst_amount: 672.0,
      sgst_amount: 672.0,
      igst_amount: 0.0,
      total_amount: 12544.0,
      is_inter_state: false,
      notes: "Initial draft generated with incorrect billing address",
      billing_name: "Aditya Roy Verma",
      billing_address: "Incorrect address line",
      fiscal_year: "26-27",
      issued_by: profileMap["receptionist"],
      issued_at: "2026-10-22T10:10:00+05:30",
      voided_at: "2026-10-22T10:45:00+05:30",
      void_reason: "Customer GSTIN and address needed correction; re-issued as GST/26-27/00001",
    },
  ];

  const { data: seededInvoices, error: invErr } = await admin.from("invoices").insert(invoicesToSeed).select();
  if (invErr) console.error("  Invoices error:", invErr.message);
  const invMap = Object.fromEntries((seededInvoices || []).map((i) => [i.invoice_number, i]));

  // Update bookings tax totals to mirror invoicing
  if (bookingMap["BK261018ADITYA"] && invMap["GST/26-27/00001"]) {
    await admin
      .from("bookings")
      .update({ tax_total: 1344.0 })
      .eq("id", bookingMap["BK261018ADITYA"].id);
  }
  if (bookingMap["BK261019RAJESH"] && invMap["GST/26-27/00002"]) {
    await admin
      .from("bookings")
      .update({ tax_total: 2184.0, credited_total: 1680.0 })
      .eq("id", bookingMap["BK261019RAJESH"].id);
  }

  // Invoice Items
  if (invMap["GST/26-27/00001"]) {
    await admin.from("invoice_items").insert([
      {
        invoice_id: invMap["GST/26-27/00001"].id,
        description: "Room accommodation, Room 101 (4 nights)",
        quantity: 4,
        unit_amount: 2800,
        amount: 11200,
        tax_rate: 12.0,
        sac_code: "996311",
      },
      {
        invoice_id: invMap["GST/26-27/00001"].id,
        description: "Extra bed (1 unit)",
        quantity: 1,
        unit_amount: 500,
        amount: 500,
        tax_rate: 12.0,
        sac_code: "996311",
      },
      {
        invoice_id: invMap["GST/26-27/00001"].id,
        description: "Promotional Stay Discount",
        quantity: 1,
        unit_amount: -500,
        amount: -500,
        tax_rate: 12.0,
        sac_code: "996311",
      },
    ]);

    await admin.from("tax_details").insert([
      { invoice_id: invMap["GST/26-27/00001"].id, tax_name: "CGST", rate: 6.0, amount: 672.0 },
      { invoice_id: invMap["GST/26-27/00001"].id, tax_name: "SGST", rate: 6.0, amount: 672.0 },
    ]);
  }

  if (invMap["GST/26-27/00002"]) {
    await admin.from("invoice_items").insert([
      {
        invoice_id: invMap["GST/26-27/00002"].id,
        description: "Deluxe Sea View accommodation, Room 201 (4 nights)",
        quantity: 4,
        unit_amount: 4800,
        amount: 19200,
        tax_rate: 12.0,
        sac_code: "996311",
      },
      {
        invoice_id: invMap["GST/26-27/00002"].id,
        description: "Corporate stay discount",
        quantity: 1,
        unit_amount: -1000,
        amount: -1000,
        tax_rate: 12.0,
        sac_code: "996311",
      },
    ]);

    await admin.from("tax_details").insert([
      { invoice_id: invMap["GST/26-27/00002"].id, tax_name: "IGST", rate: 12.0, amount: 2184.0 },
    ]);
  }

  if (invMap["INV/26-27/00001"]) {
    await admin.from("invoice_items").insert([
      {
        invoice_id: invMap["INV/26-27/00001"].id,
        description: "Room accommodation, Room 102 (3 nights)",
        quantity: 3,
        unit_amount: 2800,
        amount: 8400,
        tax_rate: 0,
      },
      {
        invoice_id: invMap["INV/26-27/00001"].id,
        description: "Room Service charges",
        quantity: 1,
        unit_amount: 450,
        amount: 450,
        tax_rate: 0,
      },
    ]);
  }

  // --------------------------------------------------------------------------
  // STEP 14: Credit Notes
  // --------------------------------------------------------------------------
  console.log("  Seeding credit notes...");
  if (invMap["GST/26-27/00002"]) {
    await admin.from("credit_notes").insert([
      {
        invoice_id: invMap["GST/26-27/00002"].id,
        credit_note_number: "CN/26-27/00001",
        amount: 1680.0,
        taxable_value: 1500.0,
        cgst_amount: 0.0,
        sgst_amount: 0.0,
        igst_amount: 180.0,
        reason: "Commercial credit allowance for delayed check-in luggage delivery",
        fiscal_year: "26-27",
        created_by: profileMap["manager"],
        created_at: "2026-10-23T11:00:00+05:30",
      },
    ]);
  }

  // --------------------------------------------------------------------------
  // STEP 15: Payment Allocations
  // --------------------------------------------------------------------------
  console.log("  Linking payment allocations to invoices...");
  const allocations = [];
  if (payMap["RC-000001"] && invMap["GST/26-27/00001"]) {
    allocations.push({
      payment_id: payMap["RC-000001"].id,
      invoice_id: invMap["GST/26-27/00001"].id,
      amount: 5000.0,
    });
  }
  if (payMap["RC-000002"] && invMap["GST/26-27/00001"]) {
    allocations.push({
      payment_id: payMap["RC-000002"].id,
      invoice_id: invMap["GST/26-27/00001"].id,
      amount: 7544.0,
    });
  }
  if (payMap["RC-000003"] && invMap["GST/26-27/00002"]) {
    allocations.push({
      payment_id: payMap["RC-000003"].id,
      invoice_id: invMap["GST/26-27/00002"].id,
      amount: 10000.0,
    });
  }
  if (payMap["RC-000004"] && invMap["GST/26-27/00002"]) {
    allocations.push({
      payment_id: payMap["RC-000004"].id,
      invoice_id: invMap["GST/26-27/00002"].id,
      amount: 8704.0,
    });
  }

  if (allocations.length > 0) {
    await admin.from("payment_allocations").insert(allocations);
  }

  // --------------------------------------------------------------------------
  // STEP 16: Expense Categories & Expenses
  // --------------------------------------------------------------------------
  console.log("  Seeding expense categories and expenses...");
  const categoriesToEnsure = [
    { name: "Salary", is_active: true },
    { name: "Electricity", is_active: true },
    { name: "Food Purchase", is_active: true },
    { name: "Maintenance", is_active: true },
    { name: "Supplies", is_active: true },
    { name: "Other", is_active: true },
    { name: "Marketing & OTA", is_active: true },
  ];

  for (const c of categoriesToEnsure) {
    await admin.from("expense_categories").upsert(c, { onConflict: "name" });
  }

  const { data: expCats } = await admin.from("expense_categories").select("id, name");
  const catMap = Object.fromEntries(expCats.map((c) => [c.name, c.id]));

  const expensesToSeed = [
    // 1. Food purchase posted today
    {
      category_id: catMap["Food Purchase"],
      account_id: accMap["upi"]?.id,
      amount: 14500.0,
      supplier: "Mapusa Wholesale Fish & Produce Market",
      payment_method: "UPI",
      description: "Fresh coastal seafood, prawns, chicken & exotic vegetables for restaurant",
      bill_path: "expense-receipts/mapusa_produce_261025.pdf",
      approval_status: "approved",
      approved_by: profileMap["manager"],
      expense_date: todayStr,
      posted: true,
      reversed: false,
      created_by: profileMap["accountant"],
      created_at: `${todayStr}T07:30:00+05:30`,
    },
    // 2. High-tension electricity bill
    {
      category_id: catMap["Electricity"],
      account_id: accMap["bank"]?.id,
      amount: 28400.0,
      supplier: "Goa Electricity Department, Calangute Sub-Division",
      payment_method: "Bank Transfer",
      description: "Monthly commercial HT power consumption bill for resort & pool pumps",
      bill_path: "expense-receipts/goa_power_oct2026.pdf",
      approval_status: "approved",
      approved_by: profileMap["owner"],
      expense_date: "2026-10-24",
      posted: true,
      reversed: false,
      created_by: profileMap["accountant"],
      created_at: "2026-10-24T11:00:00+05:30",
    },
    // 3. Hotel luxury toiletries supplies
    {
      category_id: catMap["Supplies"],
      account_id: accMap["card"]?.id,
      amount: 8750.0,
      supplier: "Seagull Luxury Amenities Pvt Ltd",
      payment_method: "Credit Card",
      description: "Bulk shampoo, conditioner, dental kits and eco-friendly guest slippers",
      bill_path: "expense-receipts/seagull_amenities.pdf",
      approval_status: "approved",
      approved_by: profileMap["manager"],
      expense_date: "2026-10-23",
      posted: true,
      reversed: false,
      created_by: profileMap["receptionist"],
      created_at: "2026-10-23T14:00:00+05:30",
    },
    // 4. Maintenance expense (to link with maintenance request!)
    {
      category_id: catMap["Maintenance"],
      account_id: accMap["cash"]?.id,
      amount: 3200.0,
      supplier: "CoolWave HVAC Services",
      payment_method: "Cash",
      description: "Room 203 split AC cooling coil servicing and Freon gas refill",
      bill_path: "expense-receipts/coolwave_hvac_203.pdf",
      approval_status: "approved",
      approved_by: profileMap["manager"],
      expense_date: todayStr,
      posted: true,
      reversed: false,
      created_by: profileMap["housekeeping"],
      created_at: `${todayStr}T11:00:00+05:30`,
    },
    // 5. Pending expense awaiting approval
    {
      category_id: catMap["Maintenance"],
      account_id: accMap["bank"]?.id,
      amount: 42000.0,
      supplier: "IFB Commercial Laundry Systems",
      payment_method: "Bank Transfer",
      description: "Purchase order for 20kg industrial laundry washer extractor",
      bill_path: "expense-receipts/ifb_commercial_quote.pdf",
      approval_status: "pending",
      expense_date: todayStr,
      posted: false,
      reversed: false,
      created_by: profileMap["accountant"],
      created_at: `${todayStr}T12:00:00+05:30`,
    },
    // 6. Reversed expense
    {
      category_id: catMap["Other"],
      account_id: accMap["cash"]?.id,
      amount: 1800.0,
      supplier: "Speedy Courier & Dispatch",
      payment_method: "Cash",
      description: "Courier fees billed twice by vendor error",
      approval_status: "approved",
      expense_date: "2026-10-22",
      posted: true,
      reversed: true,
      reversed_at: "2026-10-23T16:00:00+05:30",
      reversed_by: profileMap["accountant"],
      reverse_reason: "Vendor issued cash refund for duplicate receipt entry",
      created_by: profileMap["receptionist"],
      created_at: "2026-10-22T15:00:00+05:30",
    },
  ];

  const { data: seededExpenses, error: expErr } = await admin.from("expenses").insert(expensesToSeed).select();
  if (expErr) console.error("  Expenses error:", expErr.message);
  const maintenanceExpense = (seededExpenses || []).find((e) => e.supplier === "CoolWave HVAC Services");

  // --------------------------------------------------------------------------
  // STEP 17: Housekeeping Tasks
  // --------------------------------------------------------------------------
  console.log("  Seeding housekeeping tasks...");
  const hkTasksToSeed = [
    {
      room_id: roomMap["101"]?.id,
      booking_id: bookingMap["BK261018ADITYA"]?.id,
      status: "completed",
      priority: "medium",
      assigned_to: profileMap["housekeeping"],
      notes: "Post check-out full sanitization & deep cleaning finished.",
      started_at: "2026-10-22T11:15:00+05:30",
      completed_at: "2026-10-22T12:30:00+05:30",
      completed_by: profileMap["housekeeping"],
    },
    {
      room_id: roomMap["103"]?.id,
      status: "pending",
      priority: "urgent",
      assigned_to: profileMap["housekeeping"],
      notes: "Room marked dirty; strip bedding, disinfect bathroom and restock minibar.",
    },
    {
      room_id: roomMap["104"]?.id,
      status: "cleaning",
      priority: "high",
      assigned_to: profileMap["housekeeping"],
      notes: "Floor vacuuming and linen change currently underway.",
      started_at: `${todayStr}T11:00:00+05:30`,
    },
    {
      room_id: roomMap["203"]?.id,
      status: "inspection",
      priority: "medium",
      assigned_to: profileMap["housekeeping"],
      notes: "Cleaning complete; awaiting supervisor checklist sign-off.",
      started_at: `${todayStr}T09:30:00+05:30`,
    },
    {
      room_id: roomMap["301"]?.id,
      booking_id: bookingMap["BK261023AMITPA"]?.id,
      status: "cancelled",
      priority: "low",
      assigned_to: profileMap["housekeeping"],
      notes: "Guest hung 'Do Not Disturb' sign; afternoon turnaround cancelled.",
    },
  ];

  for (const hk of hkTasksToSeed) {
    if (hk.room_id) {
      await admin.from("housekeeping_tasks").insert(hk);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 18: Maintenance Requests
  // --------------------------------------------------------------------------
  console.log("  Seeding maintenance requests...");
  const maintenanceToSeed = [
    // Completed request linked to CoolWave expense!
    {
      room_id: roomMap["203"]?.id,
      title: "AC cooling low & abnormal compressor noise in Room 203",
      description: "Guest reported inadequate cooling during midday heat.",
      priority: "high",
      status: "completed",
      assigned_to: profileMap["housekeeping"],
      cost: 3200.0,
      block_room: false,
      reported_by: profileMap["receptionist"],
      started_at: `${todayStr}T09:30:00+05:30`,
      completed_at: `${todayStr}T11:30:00+05:30`,
      resolution_note: "Technician replaced filter and recharged refrigerant. Tested down to 18C.",
      expense_id: maintenanceExpense?.id,
    },
    // In-progress request blocking room 302
    {
      room_id: roomMap["302"]?.id,
      title: "Balcony sliding glass door latch stuck in Room 302",
      description: "Door cannot be securely locked from inside. Urgent fix needed.",
      priority: "urgent",
      status: "in_progress",
      assigned_to: profileMap["manager"],
      cost: 0,
      block_room: true,
      reported_by: profileMap["housekeeping"],
      started_at: `${todayStr}T10:00:00+05:30`,
    },
    // Open routine repair
    {
      room_id: roomMap["104"]?.id,
      title: "Bathroom mixer tap slow drip",
      description: "Washbasin hot water knob dripping periodically.",
      priority: "low",
      status: "open",
      assigned_to: profileMap["housekeeping"],
      cost: 450.0,
      block_room: false,
      reported_by: profileMap["housekeeping"],
    },
    // Urgent request blocking Presidential Suite
    {
      room_id: roomMap["501"]?.id,
      title: "Presidential Suite annual teakwood deck polish & jacuzzi check",
      description: "Scheduled preventive maintenance before high season VIP bookings.",
      priority: "medium",
      status: "open",
      assigned_to: profileMap["manager"],
      cost: 15000.0,
      block_room: true,
      reported_by: profileMap["owner"],
    },
  ];

  for (const m of maintenanceToSeed) {
    if (m.room_id) {
      await admin.from("maintenance_requests").insert(m);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 19: Opening Account Ledger & Transactions
  // --------------------------------------------------------------------------
  console.log("  Establishing opening account ledger balances...");
  // Account transactions from payments/refunds/expenses were created automatically by DB triggers!
  // Let's add initial opening operating capital transactions so balances reflect healthy resort finances:
  const openingTrans = [
    {
      account_id: accMap["cash"]?.id,
      txn_type: "credit",
      amount: 50000.0,
      description: "Opening float for front office reception cash drawer",
      reference_type: "opening_balance",
      created_by: profileMap["owner"],
      created_at: "2026-10-01T00:00:00+05:30",
    },
    {
      account_id: accMap["bank"]?.id,
      txn_type: "credit",
      amount: 450000.0,
      description: "Opening operating bank account balance (HDFC Current Account)",
      reference_type: "opening_balance",
      created_by: profileMap["owner"],
      created_at: "2026-10-01T00:00:00+05:30",
    },
    {
      account_id: accMap["upi"]?.id,
      txn_type: "credit",
      amount: 85000.0,
      description: "Opening merchant UPI settlement account balance",
      reference_type: "opening_balance",
      created_by: profileMap["owner"],
      created_at: "2026-10-01T00:00:00+05:30",
    },
  ];

  for (const ot of openingTrans) {
    if (ot.account_id) {
      await admin.from("account_transactions").insert(ot);
    }
  }

  // --------------------------------------------------------------------------
  // STEP 20: Audit Logs
  // --------------------------------------------------------------------------
  console.log("  Recording audit log entries across all modules...");
  const auditLogsToSeed = [
    {
      actor_id: profileMap["receptionist"],
      action: "check_in",
      entity_type: "bookings",
      entity_id: bookingMap["BK261022ANANYA"]?.id,
      details: { booking_code: "BK261022ANANYA", room_number: "102", guest: "Ananya Deshmukh" },
      created_at: "2026-10-22T15:20:00+05:30",
    },
    {
      actor_id: profileMap["receptionist"],
      action: "check_out",
      entity_type: "bookings",
      entity_id: bookingMap["BK261018ADITYA"]?.id,
      details: { booking_code: "BK261018ADITYA", final_bill: 12544, room_number: "101" },
      created_at: "2026-10-22T11:00:00+05:30",
    },
    {
      actor_id: profileMap["receptionist"],
      action: "issue_invoice",
      entity_type: "invoices",
      entity_id: invMap["GST/26-27/00001"]?.id,
      details: { invoice_number: "GST/26-27/00001", type: "gst", total: 12544 },
      created_at: "2026-10-22T10:50:00+05:30",
    },
    {
      actor_id: profileMap["manager"],
      action: "issue_credit_note",
      entity_type: "credit_notes",
      entity_id: invMap["GST/26-27/00002"]?.id,
      details: { credit_note_number: "CN/26-27/00001", amount: 1680, reason: "Delayed luggage" },
      created_at: "2026-10-23T11:00:00+05:30",
    },
    {
      actor_id: profileMap["accountant"],
      action: "record_expense",
      entity_type: "expenses",
      entity_id: maintenanceExpense?.id,
      details: { category: "Maintenance", amount: 3200, supplier: "CoolWave HVAC Services" },
      created_at: `${todayStr}T11:00:00+05:30`,
    },
    {
      actor_id: profileMap["manager"],
      action: "approve_refund",
      entity_type: "refunds",
      details: { amount: 800, booking_code: "BK261018ADITYA", method: "UPI" },
      created_at: `${todayStr}T09:00:00+05:30`,
    },
    {
      actor_id: profileMap["housekeeping"],
      action: "complete_task",
      entity_type: "housekeeping_tasks",
      details: { room_number: "101", task: "turnover_cleaning" },
      created_at: "2026-10-22T12:30:00+05:30",
    },
  ];

  await admin.from("audit_logs").insert(auditLogsToSeed);

  // --------------------------------------------------------------------------
  // STEP 21: Verification & Table Summary
  // --------------------------------------------------------------------------
  console.log("\n[3/3] Verifying row counts across all 29 database tables...\n");
  const finalCounts = await getTableCounts();

  console.log("------------------------------------------------------------");
  console.log(String("TABLE NAME").padEnd(28) + String("ROW COUNT").padStart(12) + String("STATUS").padStart(16));
  console.log("------------------------------------------------------------");

  let allPopulated = true;
  for (const [table, count] of Object.entries(finalCounts)) {
    const isError = typeof count === "string" && count.startsWith("ERR");
    const isZero = count === 0;
    let statusText = "POPULATED";
    if (isError) {
      statusText = "ERROR";
      allPopulated = false;
    } else if (isZero) {
      statusText = "EMPTY";
      allPopulated = false;
    }

    console.log(
      table.padEnd(28) +
        String(count).padStart(12) +
        `  [${statusText}]`.padStart(16)
    );
  }
  console.log("------------------------------------------------------------");

  if (allPopulated) {
    console.log("\nSUCCESS: All 29 tables have been successfully seeded with realistic data!");
  } else {
    console.warn("\nNOTICE: Some tables may still be empty or encountered errors. Review table output above.");
  }
}

main().catch((err) => {
  console.error("\nFATAL ERROR during seed execution:", err);
  process.exit(1);
});
