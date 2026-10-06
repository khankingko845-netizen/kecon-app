/**
 * Zod helpers for API route input (T04). Every route parses its body with a
 * schema and returns 400 with a readable message when it does not match.
 */
import { z } from "zod";
import { LLM_PROVIDERS } from "@/lib/llm";

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

export function invalidInput(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): Response {
  return Response.json(
    {
      error: "Dữ liệu gửi lên không hợp lệ",
      code: "invalid_body",
      issues: issues.slice(0, 10).map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    },
    { status: 400 }
  );
}

/** Parse a JSON request body against a schema. */
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<Parsed<z.output<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Body phải là JSON hợp lệ", code: "invalid_json" }, { status: 400 }),
    };
  }
  return parseValue(raw, schema);
}

/** Validate an already-read value (FormData fields, query params…). */
export function parseValue<S extends z.ZodType>(raw: unknown, schema: S): Parsed<z.output<S>> {
  const result = schema.safeParse(raw);
  if (!result.success) return { ok: false, response: invalidInput(result.error.issues) };
  return { ok: true, data: result.data };
}

// ── Reusable field schemas ─────────────────────────────────────────────────

/** Optional trimmed string; "" / null become undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || undefined);

/** Required trimmed, non-empty string. */
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

export const uuid = z.uuid();

/** Model ids: letters, digits and . _ - : / @ (no spaces, no URL tricks). */
export const modelId = z
  .string()
  .trim()
  .max(120)
  .regex(/^[\w.:/@-]*$/, "Model id không hợp lệ")
  .nullish()
  .transform((v) => v || undefined);

export const languageCode = z
  .string()
  .trim()
  .regex(/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, "Mã ngôn ngữ không hợp lệ")
  .nullish()
  .transform((v) => v || undefined);

/** Fields every AI route accepts for BYO-key / provider selection. */
export const llmSelectionFields = {
  provider: z.enum(LLM_PROVIDERS).nullish(),
  model: modelId,
  apiKey: optionalText(512),
  baseUrl: optionalText(2048).pipe(z.url().optional()),
};

/** A base64 image or `data:image/...;base64,` URL, max ~8 MB encoded. */
export const imageData = z
  .string()
  .min(16)
  .max(8 * 1024 * 1024 * 1.4)
  .refine(
    (s) => /^data:image\/(png|jpe?g|webp|gif|heic|heif);base64,/i.test(s) || /^[A-Za-z0-9+/=\s]+$/.test(s.slice(0, 256)),
    "Ảnh phải là data URL base64 (png/jpeg/webp/gif/heic)"
  );
