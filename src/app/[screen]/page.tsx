import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { createClient } from "@/lib/supabase/server";
import { SCREEN_FEATURE } from "@/lib/feature-flags";
import { canOpenServerFeatureScreen } from "@/lib/feature-flags-server";
import type { Screen } from "@/lib/types";
export default async function OptionalScreen({params}:{params:Promise<{screen:string}>}) {
 const {screen}=await params;
 if(!Object.hasOwn(SCREEN_FEATURE,screen) || !await canOpenServerFeatureScreen(await createClient(),screen as Screen)) notFound();
 return <AppShell initialScreen={screen as Screen} />;
}
