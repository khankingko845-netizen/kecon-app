/**
 * Print the SQL that imports (or rolls back) a platform library pack.
 *
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts \
 *     --pack v1 --owner <staff profile uuid> --voices voices.json [--reason "…"] > import.sql
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --rollback > rollback.sql
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --recast --voices voices.json > recast.sql
 *   node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --art > art.sql   # picture direction only
 *
 * voices.json = active default_voices rows for the locale:
 *   [{ "voice_id": "…", "name": "…", "gender": "female", "description": "…", "sort_order": 1 }, …]
 * Run the SQL as the database owner (psql -v ON_ERROR_STOP=1); see docs/library-v1.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  LibraryStorySchema,
  buildLibraryArtSyncSql,
  buildLibraryImportSql,
  buildLibraryRecastSql,
  buildLibraryRollbackSql,
  packProblems,
} from "@/lib/library-pack";

const { values } = parseArgs({
  options: {
    pack: { type: "string", default: "v1" },
    owner: { type: "string" },
    voices: { type: "string" },
    reason: { type: "string" },
    rollback: { type: "boolean", default: false },
    recast: { type: "boolean", default: false },
    art: { type: "boolean", default: false },
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

if (values.art) {
  process.stdout.write(buildLibraryArtSyncSql(stories, values.reason ?? `Đồng bộ chỉ dẫn tranh minh hoạ kho truyện ${version}`));
} else if (values.rollback) {
  process.stdout.write(buildLibraryRollbackSql(stories.map((s) => s.slug), values.reason ?? `Gỡ kho truyện ${version}`));
} else {
  if (!values.voices) throw new Error("--voices is required");
  const voices = JSON.parse(readFileSync(values.voices, "utf8"));
  if (!Array.isArray(voices) || voices.length === 0) throw new Error("voices.json must be a non-empty array");
  if (values.recast) {
    process.stdout.write(buildLibraryRecastSql(stories, voices, values.reason ?? `Gán lại giọng nhân vật kho truyện ${version}`));
    process.exit(0);
  }
  if (!values.owner) throw new Error("--owner is required");
  process.stdout.write(
    buildLibraryImportSql(stories, {
      ownerId: values.owner,
      voices,
      version,
      reason: values.reason ?? `Nhập kho truyện ${version} (${stories.length} truyện, xem docs/library-${version}.md)`,
    }),
  );
}
