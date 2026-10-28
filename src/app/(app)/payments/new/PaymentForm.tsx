"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, inputCls, btnPrimary } from "@/components/ui";
import { recordPayment } from "../actions";

export type PayableBooking = {
  id: string;
  code: string;
  guest: string;
  status: string;
  due: number;
  total: number;
  paid: number;
};
export type MethodOption = { id: string; name: string; requires_reference: boolean };

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function PaymentForm({
  bookings,
  methods,
  defaultBookingId,
}: {
  bookings: PayableBooking[];
  methods: MethodOption[];
  defaultBookingId?: string;
}) {
  const initial = bookings.find((b) => b.id === defaultBookingId);
  const [bookingId, setBookingId] = useState(initial?.id ?? "");
  const [amount, setAmount] = useState(initial ? String(initial.due) : "");
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");

  const booking = bookings.find((b) => b.id === bookingId);
  const method = methods.find((m) => m.id === methodId);

  return (
    <ActionForm action={recordPayment} className="grid max-w-2xl gap-4 sm:grid-cols-2">
      <Field label="Booking" hint="Only bookings with a balance due are listed" className="sm:col-span-2">
        <select
          name="booking_id"
          required
          value={bookingId}
          onChange={(e) => {
            setBookingId(e.target.value);
            const b = bookings.find((x) => x.id === e.target.value);
            setAmount(b ? String(b.due) : "");
          }}
          className={inputCls}
        >
          <option value="">Select booking</option>
          {bookings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.guest} · due {inr.format(b.due)}
            </option>
          ))}
        </select>
      </Field>

      {booking ? (
        <div className="grid grid-cols-3 gap-3 rounded-2xl bg-[var(--brand-tint)] p-4 text-sm sm:col-span-2">
          <div>
            <p className="text-xs text-[var(--muted)]">Total</p>
            <p className="font-semibold">{inr.format(booking.total)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Paid so far</p>
            <p className="font-semibold">{inr.format(booking.paid)}</p>
          </div>
          <div>
            <p className="text-xs text-[var(--muted)]">Balance due</p>
            <p className="font-semibold">{inr.format(booking.due)}</p>
          </div>
        </div>
      ) : null}

      <Field label="Amount received (₹)" hint={booking ? `Up to ${inr.format(booking.due)}` : undefined}>
        <input
          type="number"
          name="amount"
          min="0.01"
          max={booking?.due}
          step="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputCls}
        />
        {booking && Number(amount) !== booking.due ? (
          <button
            type="button"
            onClick={() => setAmount(String(booking.due))}
            className="mt-1 text-xs font-medium text-[var(--brand)] hover:underline"
          >
            Pay full balance
          </button>
        ) : null}
      </Field>

      <Field label="Payment method">
        <select
          name="method_id"
          required
          value={methodId}
          onChange={(e) => setMethodId(e.target.value)}
          className={inputCls}
        >
          {methods.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </Field>

      <Field
        label={method?.requires_reference ? "Transaction reference (required)" : "Transaction reference (optional)"}
        hint="UPI ID / UTR / card approval code"
        className="sm:col-span-2"
      >
        <input name="reference" required={method?.requires_reference} className={inputCls} />
      </Field>

      <Field label="Notes (optional)" className="sm:col-span-2">
        <textarea name="notes" rows={2} className={inputCls} />
      </Field>

      {booking && ["enquiry", "hold"].includes(booking.status) ? (
        <p className="rounded-xl bg-[var(--brand-tint)] px-3 py-2 text-sm text-[var(--brand)] sm:col-span-2">
          This booking is {booking.status}. Receiving a payment will confirm it.
        </p>
      ) : null}

      <SubmitButton className={`${btnPrimary} sm:col-span-2`} pendingLabel="Saving payment…">
        Save payment
      </SubmitButton>
    </ActionForm>
  );
}
