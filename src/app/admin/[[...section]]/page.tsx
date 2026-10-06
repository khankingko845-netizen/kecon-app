import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdminApp from "@/components/admin/AdminApp";
import { getAdminViewer } from "@/lib/admin-guard";
import { sectionFromSegments } from "@/lib/admin-routes";

/**
 * Admin v2 · A-01 — `/admin` and `/admin/<section>`. The guard runs on the
 * server for every request (incl. client-side navigations, which fetch this
 * component's RSC payload): no admin session → the ordinary 404, so visitors
 * and families can't tell the console exists. Nothing admin-related (not even
 * the page title) is sent before the check passes.
 */
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ section?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [viewer, { section }] = await Promise.all([getAdminViewer(), params]);
  const current = sectionFromSegments(section);
  if (!viewer || !current) return {};
  return { title: `${current.label} · Quản trị KểCon`, robots: { index: false, follow: false } };
}

export default async function AdminPage({ params }: Props) {
  const [viewer, { section }] = await Promise.all([getAdminViewer(), params]);
  const current = sectionFromSegments(section);
  if (!viewer || !current) notFound();
  return <AdminApp screen={current.screen} viewer={{ email: viewer.email, role: viewer.role }} />;
}
