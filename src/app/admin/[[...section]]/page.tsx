import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminMfaGate from "@/components/admin/AdminMfaGate";
import AdminSessionBoundary from "@/components/admin/AdminSessionBoundary";
import AdminApp from "@/components/admin/AdminApp";
import { getAdminViewer, type AdminViewer } from "@/lib/admin-guard";
import { sectionFromSegments, type AdminSection } from "@/lib/admin-routes";

/**
 * Admin v2 · A-01 — `/admin` and `/admin/<section>`. The guard runs on the
 * server for every request (incl. client-side navigations, which fetch this
 * component's RSC payload): no admin session → the ordinary 404, so visitors
 * and families can't tell the console exists. Nothing admin-related (not even
 * the page title) is sent before the check passes.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ section?: string[] }> };

/** A-02: a section the viewer has no permission for is a 404 too (not a 403 that confirms it exists). */
function allowed(viewer: AdminViewer | null, section: AdminSection | null): section is AdminSection {
  return Boolean(viewer && section && viewer.permissions.includes(section.permission));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [viewer, { section }] = await Promise.all([getAdminViewer(), params]);
  const current = sectionFromSegments(section);
  if (!allowed(viewer, current)) return {};
  if (viewer!.access.state !== "ready") return { title: "Xác thực quản trị · KểCon", robots: { index: false, follow: false } };
  return { title: `${current.label} · Quản trị KểCon`, robots: { index: false, follow: false } };
}

export default async function AdminPage({ params }: Props) {
  const [viewer, { section }] = await Promise.all([getAdminViewer(), params]);
  const current = sectionFromSegments(section);
  if (!viewer || !allowed(viewer, current)) notFound();
  if (viewer.access.state !== "ready") return <AdminMfaGate access={viewer.access} />;
  return (
    <AdminSessionBoundary key={viewer.access.expires_at} initial={viewer.access}>
    <AdminApp
      screen={current.screen}
      viewer={{ email: viewer.email, role: viewer.role, permissions: viewer.permissions }}
    />
    </AdminSessionBoundary>
  );
}
