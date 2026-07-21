import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/admin-auth";
import { getContent, storeConfigured } from "@/lib/content-store";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminEditor from "@/components/admin/AdminEditor";

/** Never index or follow the admin panel. */
export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false, nocache: true },
};

// Reads the session cookie — must render per request.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(token);

  if (!authed) {
    return <AdminLogin configured={!!process.env.ADMIN_PASSWORD} />;
  }

  const content = await getContent();
  return <AdminEditor initial={content} persistent={storeConfigured} />;
}
