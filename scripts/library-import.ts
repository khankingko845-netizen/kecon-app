/**
 * Print the SQL that imports (or rolls back) a platform library pack.
 *
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts \
 *     --pack v1 --owner <staff profile uuid> --voices voices.json [--reason "…"] > import.sql
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --rollback > rollback.sql
 *
 * voices.json = active default_voices rows for the locale:
 *   [{ "voice_id": "…", "name": "…", "gender": "female", "description": "…", "sort_order": 1 }, …]
 * Run the SQL as the database owner (psql -v ON_ERROR_STOP=1); see docs/library-v1.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { LibraryStorySchema, buildLibraryImportSql, buildLibraryRollbackSql, packProblems } from "@/lib/library-pack";

const { values } = parseArgs({
  options: {
    pack: { type: "string", default: "v1" },
    owner: { type: "string" },
    voices: { type: "string" },
    reason: { type: "string" },
    rollback: { type: "boolean", default: false },
  },
});

const version = values.pack ?? "v1";
if (!/^v\d+$/.test(version)) throw new Error("--pack must look like v1");
const dir = path.join(process.cwd(), "content/library", version);
const raw = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown);
const problems = packProblems(raw);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const stories = raw.map((r) => LibraryStorySchema.parse(r));

if (values.rollback) {
  process.stdout.write(buildLibraryRollbackSql(stories.map((s) => s.slug), values.reason ?? `Gỡ kho truyện ${version}`));
} else {
  if (!values.owner || !values.voices) throw new Error("--owner and --voices are required");
  const voices = JSON.parse(readFileSync(values.voices, "utf8"));
  if (!Array.isArray(voices) || voices.length === 0) throw new Error("voices.json must be a non-empty array");
  process.stdout.write(
    buildLibraryImportSql(stories, {
      ownerId: values.owner,
      voices,
      version,
      reason: values.reason ?? `Nhập kho truyện ${version} (${stories.length} truyện, xem docs/library-${version}.md)`,
    }),
  );
}
