"use client";

import { AdminConfirmProvider } from "@/components/admin/AdminConfirm";
import type { ReactNode } from "react";
import { SettingsProvider } from "@/lib/settings-context";
import { AuthProvider } from "@/lib/auth-context";
import { DataProvider } from "@/lib/data-context";
import { AudioPlayerProvider } from "@/lib/audio-player-context";
import { ParentalControlsProvider } from "@/lib/parental-controls-context";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/Toast";
import { ThemeProvider } from "@/lib/theme-context";
import { FeedbackProvider } from "@/lib/feedback-context";
import { AgeUiProvider } from "@/lib/age-ui-context";

/**
 * Shared client context stack for the kid app (`/`) and the admin console
 * (`/admin`, A-01) — both reuse the same screens, so they need the same data,
 * auth, audio and i18n providers.
 */
export default function AppProviders({ children }: { children: ReactNode }) {
 return (
 <AuthProvider>
 <SettingsProvider>
 <DataProvider>
 <AudioPlayerProvider>
 <I18nProvider>
 <ThemeProvider>
 <AgeUiProvider>
 <FeedbackProvider>
 <ToastProvider>
 <ParentalControlsProvider><AdminConfirmProvider>{children}</AdminConfirmProvider></ParentalControlsProvider>
 </ToastProvider>
 </FeedbackProvider>
 </AgeUiProvider>
 </ThemeProvider>
 </I18nProvider>
 </AudioPlayerProvider>
 </DataProvider>
 </SettingsProvider>
 </AuthProvider>
 );
}
