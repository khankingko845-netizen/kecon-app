/** G-10 · shape of `missions_weekly_summary()` (migration 038). Aggregates only. */
export interface MissionsWeek {
  week_start: string;
  week_end: string;
  /** The current week, still running. */
  partial: boolean;
  families_listening: number;
  /** Fewer than `min_families` families listened: the nights histogram is hidden. */
  small_sample: boolean;
  avg_nights: number | null;
  /** Families by number of nights with a finished story (1–7); null when the sample is small. */
  nights_histogram: Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", number> | null;
  listening: {
    started: number;
    finished: number;
    expired: number;
    /** null: not tracked yet that week (before migration 038). */
    too_fast: number | null;
    finish_rate: number | null;
    /** false: started/expired were back-filled from what was left after pruning. */
    exact: boolean;
  };
  missions_done: number;
  habits: { confirmed: number; families: number };
  kindness: { thanked: number; families: number };
  family_reads: { reads: number; families: number; reached_target: number };
  guardrails: {
    bedtime_sessions: number;
    nights_3plus: number;
    family_nights: number;
    avg_minutes_per_night: number | null;
  };
  reminders: { sent: number; failed: number; skipped: number; turned_off: number };
}

export interface MissionsMetrics {
  weeks: MissionsWeek[];
  week_count: number;
  timezone: string;
  week_starts: "monday";
  generated_at: string;
  min_families: number;
  families_total: number;
  reminders_on: number;
  funnel_since: string | null;
}
