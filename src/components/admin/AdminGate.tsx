"use client";

import { useEffect, useState } from "react";
import AdminLogin from "@/components/admin/AdminLogin";
import AdminEditor from "@/components/admin/AdminEditor";
import type { SiteContent } from "@/lib/site-content";

type Session = { authed: boolean; configured: boolean; persistent: boolean; content?: SiteContent };

/** /admin is static; the session check and content come from the admin functions. */
export default function AdminGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Session>) : Promise.reject()))
      .then(setSession)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, color: "var(--text-secondary)", fontSize: 13.5 }}>
        Couldn&apos;t reach the admin service. Refresh to try again.
      </div>
    );
  }
  if (!session) return <div style={{ minHeight: "100vh" }} />;
  if (!session.authed || !session.content) return <AdminLogin configured={session.configured} />;
  return <AdminEditor initial={session.content} persistent={session.persistent} />;
}
