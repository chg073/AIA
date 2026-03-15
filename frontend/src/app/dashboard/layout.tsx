import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardSidebar from "@/components/DashboardSidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <div className="min-h-screen bg-background flex">
      <DashboardSidebar profile={profile} email={user.email} />

      {/* Main content - left margin only on desktop */}
      <main className="flex-1 md:ml-64 p-4 pt-16 md:p-8 md:pt-8">
        {children}
      </main>
    </div>
  );
}
