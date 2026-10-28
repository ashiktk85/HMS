import { createClient } from "@/lib/supabase/server";
import { formatMoney, rel } from "@/lib/types";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";

const dateTime = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

type Guest = { full_name: string; mobile: string | null };
type Room = { room_number: string };
type ReceiptBooking = {
  booking_code: string;
  check_in_date: string;
  check_out_date: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  guests: Guest | Guest[] | null;
  rooms: Room | Room[] | null;
};

export default async function PaymentReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: payment }, { data: settings }] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "*, bookings(booking_code, check_in_date, check_out_date, total_amount, amount_paid, balance_due, guests(full_name, mobile), rooms(room_number)), profiles!payments_received_by_fkey(full_name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("hotel_settings").select("*").limit(1).maybeSingle(),
  ]);
  if (!payment) notFound();

  const booking = rel(payment.bookings as ReceiptBooking | ReceiptBooking[] | null);
  const guest = rel(booking?.guests ?? null);
  const room = rel(booking?.rooms ?? null);
  const receivedBy = rel(
    payment.profiles as { full_name: string } | { full_name: string }[] | null,
  )?.full_name;

  return (
    <div className="min-h-screen bg-white p-8 text-black">
      <div className="mx-auto max-w-xl">
        <div className="no-print mb-6 flex justify-end">
          <PrintButton />
        </div>
        <div className="mb-6 flex justify-between border-b border-stone-300 pb-4">
          <div>
            <h1 className="text-xl font-semibold">{settings?.hotel_name}</h1>
            {settings?.address ? <p className="text-sm">{settings.address}</p> : null}
            {settings?.phone ? <p className="text-sm">{settings.phone}</p> : null}
            {settings?.gstin ? <p className="text-sm">GSTIN: {settings.gstin}</p> : null}
          </div>
          <div className="text-right text-sm">
            <p className="text-lg font-semibold">PAYMENT RECEIPT</p>
            <p>{payment.receipt_no}</p>
            <p>{dateTime.format(new Date(payment.received_at))}</p>
          </div>
        </div>

        {payment.voided ? (
          <p className="mb-4 border border-red-400 p-2 text-center text-sm font-semibold text-red-700">
            VOIDED{payment.void_reason ? `: ${payment.void_reason}` : ""}
          </p>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <dt className="text-stone-500">Received from</dt>
          <dd>
            {guest?.full_name}
            {guest?.mobile ? ` (${guest.mobile})` : ""}
          </dd>
          <dt className="text-stone-500">Booking</dt>
          <dd>
            {booking?.booking_code}
            {room ? ` · Room ${room.room_number}` : ""}
          </dd>
          <dt className="text-stone-500">Stay</dt>
          <dd>
            {booking?.check_in_date} to {booking?.check_out_date}
          </dd>
          <dt className="text-stone-500">Payment method</dt>
          <dd>{payment.method}</dd>
          <dt className="text-stone-500">Transaction reference</dt>
          <dd>{payment.reference || "—"}</dd>
          <dt className="text-stone-500">Received by</dt>
          <dd>{receivedBy || "—"}</dd>
        </dl>

        <div className="my-6 border-y border-stone-300 py-4 text-center">
          <p className="text-sm text-stone-500">Amount received</p>
          <p className="text-3xl font-semibold">{formatMoney(payment.amount)}</p>
        </div>

        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Booking total</dt>
            <dd>{formatMoney(booking?.total_amount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Total paid to date</dt>
            <dd>{formatMoney(booking?.amount_paid)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Balance due</dt>
            <dd>{formatMoney(booking?.balance_due)}</dd>
          </div>
        </dl>
        <p className="mt-8 text-center text-xs text-stone-500">This is a payment receipt, not a tax invoice.</p>
      </div>
    </div>
  );
}
