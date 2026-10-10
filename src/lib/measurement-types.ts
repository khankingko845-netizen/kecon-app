import { z } from "zod";
export const PriceSchema = z
  .strictObject({
    provider: z.enum([
      "openai",
      "gemini",
      "anthropic",
      "custom",
      "elevenlabs",
      "fishaudio",
    ]),
    model: z.string().regex(/^[A-Za-z0-9_.:/-]{1,120}$/),
    kind: z.enum(["llm", "image", "tts", "clone", "ambient"]),
    input: z.number().min(0).max(1e6).nullable(),
    output: z.number().min(0).max(1e6).nullable(),
    unit: z.number().min(0).max(1e6).nullable(),
    billingUnit: z.literal("utf8_bytes").optional(),
    source: z
      .url()
      .max(240)
      .regex(/^https:\/\/[^?#\s]+$/),
  })
  .refine((v) =>
    v.kind === "llm"
      ? v.input !== null && v.output !== null && v.unit === null
      : v.unit !== null && v.input === null && v.output === null,
  )
  .refine((v) =>
    v.provider === "fishaudio"
      ? v.kind === "tts" && v.billingUnit === "utf8_bytes"
      : v.billingUnit === undefined,
  );
export type Price = {
  input_per_million: number | null;
  output_per_million: number | null;
  unit_usd: number | null;
  source: string;
  updated_at: string;
  billing_unit?: string | null;
  price_version?: number;
};
export type CostRow = {
  day: string;
  provider: string;
  feature: string;
  attempts: number;
  succeeded: number;
  failed: number;
  pending: number;
  estimated_usd: number | null;
  unknown_cost: number;
  byo_attempts: number;
  input_tokens: number;
  output_tokens: number;
  legacy_unit_attempts?: number;
};
export type MeasurementSummary = {
  days: number;
  since: string;
  timezone: string;
  costs: CostRow[];
  totals: {
    attempts: number;
    estimated_usd: number | null;
    unknown_cost: number;
    pending: number;
    byo_attempts: number;
    legacy_unit_attempts?: number;
  };
  funnel: {
    signup: number;
    home_view: number;
    first_listen: number;
    story_created: number;
  };
};
export function estimateUsd(
  kind: string,
  price: Price | null,
  input: number | null,
  output: number | null,
  units: number | null,
  usage?: { provider: string; billingUnit?: string; usageVersion?: number },
): number | null {
  if (!price) return null;
  // Never multiply new byte usage by an unversioned historical character rate.
  if (
    usage?.provider === "fishaudio" &&
    (kind !== "tts" ||
      usage.billingUnit !== "utf8_bytes" ||
      usage.usageVersion !== 2 ||
      price.billing_unit !== "utf8_bytes" ||
      price.price_version !== 2)
  )
    return null;
  if (kind === "llm") {
    if (
      input === null ||
      output === null ||
      price.input_per_million === null ||
      price.output_per_million === null
    )
      return null;
    return (
      (input * Number(price.input_per_million) +
        output * Number(price.output_per_million)) /
      1e6
    );
  }
  return units === null || price.unit_usd === null
    ? null
    : units * Number(price.unit_usd);
}
