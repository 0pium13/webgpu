import type { Metadata } from "next";
import AdminGate from "@/components/admin/AdminGate";

/** Never index or follow the admin panel. */
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminGate />;
}
