import { AppShell } from "@/components/AppShell";
import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionProfile();
  if (!session) redirect("/login");

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("hotel_settings")
    .select("hotel_name")
    .limit(1)
    .maybeSingle();

  return (
    <AppShell
      role={session.role}
      name={session.profile?.full_name || session.user.email || "Staff"}
      hotelName={settings?.hotel_name || "Hotel Cloud HMS"}
    >
      {children}
    </AppShell>
  );
}
