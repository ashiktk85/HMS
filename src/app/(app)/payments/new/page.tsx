import Link from "next/link";
import { PageHeader, Panel, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { rel } from "@/lib/types";
import { PaymentForm } from "./PaymentForm";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ booking_id?: string }>;
}) {
  const { booking_id } = await searchParams;
  const supabase = await createClient();
  const [{ data: bookings }, { data: methods }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, booking_code, status, total_amount, amount_paid, balance_due, guests(full_name)")
      .in("status", ["enquiry", "hold", "confirmed", "checked_in", "checked_out"])
      .gt("balance_due", 0)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("payment_methods")
      .select("id, name, requires_reference")
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  return (
    <div>
      <PageHeader
        title="Record payment"
        description="One entry updates the booking balance and the right account."
        actions={
          <Link href="/payments" className="text-sm font-medium text-[var(--brand)] hover:underline">
            Back
          </Link>
        }
      />
      <Panel>
        {!methods?.length ? (
          <EmptyState message="No payment methods are set up. An owner or manager can add them in Settings." />
        ) : (
          <PaymentForm
            bookings={(bookings || []).map((b) => ({
              id: b.id,
              code: b.booking_code,
              guest:
                rel(b.guests as { full_name: string } | { full_name: string }[] | null)?.full_name ?? "Guest",
              status: b.status,
              due: Number(b.balance_due),
              total: Number(b.total_amount),
              paid: Number(b.amount_paid),
            }))}
            methods={methods}
            defaultBookingId={booking_id}
          />
        )}
      </Panel>
    </div>
  );
}
