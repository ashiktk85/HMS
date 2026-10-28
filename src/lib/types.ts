export type AppRole =
  | "owner"
  | "manager"
  | "receptionist"
  | "accountant"
  | "housekeeping";

export type RoomStatus =
  | "available"
  | "reserved"
  | "occupied"
  | "dirty"
  | "cleaning"
  | "inspection"
  | "maintenance"
  | "blocked";

export type BookingStatus =
  | "enquiry"
  | "hold"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export type BookingSource = "direct" | "walk_in" | "phone" | "whatsapp";

export type InvoiceType = "gst" | "non_gst";

export const ROOM_STATUSES: RoomStatus[] = [
  "available",
  "reserved",
  "occupied",
  "dirty",
  "cleaning",
  "inspection",
  "maintenance",
  "blocked",
];

export const BOOKING_STATUSES: BookingStatus[] = [
  "enquiry",
  "hold",
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  manager: "Manager",
  receptionist: "Receptionist",
  accountant: "Accountant",
  housekeeping: "Housekeeping",
};

export function formatMoney(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(n);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function nightsBetween(checkIn: string, checkOut: string) {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  const ms = b.getTime() - a.getTime();
  return Math.max(Math.round(ms / (1000 * 60 * 60 * 24)), 1);
}

export function canAccessSettings(role: AppRole | null | undefined) {
  return role === "owner" || role === "manager";
}

export function labelize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Unwrap Supabase nested relation that may be object or array */
export function rel<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Statuses a booking may move to from the booking screen. Check-in/out have their own actions. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  enquiry: ["hold", "confirmed", "cancelled"],
  hold: ["confirmed", "cancelled", "no_show"],
  confirmed: ["cancelled", "no_show"],
  checked_in: [],
  checked_out: [],
  cancelled: ["enquiry", "hold", "confirmed"],
  no_show: ["cancelled"],
};

/** Booking statuses that occupy a room for their dates (mirrors the DB overlap trigger). */
export const BLOCKING_BOOKING_STATUSES: BookingStatus[] = ["hold", "confirmed", "checked_in"];

export function bookingTone(status: string) {
  if (status === "confirmed" || status === "checked_in") return "ok" as const;
  if (status === "enquiry" || status === "hold") return "info" as const;
  if (status === "checked_out") return "neutral" as const;
  return "danger" as const;
}

export function expenseState(e: { approval_status: string; posted: boolean; reversed: boolean }) {
  if (e.reversed) return { label: "Reversed", tone: "neutral" as const };
  if (e.approval_status === "pending") return { label: "Waiting approval", tone: "warn" as const };
  if (e.approval_status === "rejected") return { label: "Rejected", tone: "danger" as const };
  return { label: "Posted", tone: "ok" as const };
}

export type RoomCategory = "regular" | "driver";
export type AcOption = "ac" | "non_ac";

export const ROOM_CATEGORIES: RoomCategory[] = ["regular", "driver"];
export const ROOM_CATEGORY_LABELS: Record<RoomCategory, string> = {
  regular: "Regular (customer) room",
  driver: "Driver room",
};
export const AC_LABELS: Record<AcOption, string> = { ac: "AC", non_ac: "Non-AC" };
