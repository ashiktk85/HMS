"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionResult } from "@/components/ActionForm";
import { Field, inputCls, btnPrimary } from "@/components/ui";

type Service = { id: string; name: string; default_amount: number };

export function FolioForm({
  services,
  action,
}: {
  services: Service[];
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [serviceId, setServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  return (
    <ActionForm
      action={action}
      resetOnSuccess
      successMessage="Charge added"
      className="mb-4 grid gap-3 md:grid-cols-4"
      onSuccess={() => {
        setServiceId("");
        setDescription("");
        setAmount("");
      }}
    >
      <Field label="Service" hint="Pick a service to fill in its usual price">
        <select
          name="service_item_id"
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value);
            const s = services.find((x) => x.id === e.target.value);
            if (s) {
              setDescription(s.name);
              setAmount(String(s.default_amount));
            }
          }}
          className={inputCls}
        >
          <option value="">Custom charge</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <input name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Laundry" required className={inputCls} />
      </Field>
      <Field label="Quantity">
        <input name="quantity" type="number" min="0.01" step="0.01" defaultValue={1} className={inputCls} />
      </Field>
      <Field label="Unit amount (₹)">
        <input name="unit_amount" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required className={inputCls} />
      </Field>
      <SubmitButton className={`${btnPrimary} md:col-span-4`}>Add charge</SubmitButton>
    </ActionForm>
  );
}
