// Lets plain Node (>= 22.15, native type stripping) run repo TypeScript that
// uses the "@/..." alias, extensionless imports and JSON imports:
//   node --import ./scripts/ts-paths.mjs scripts/library-import.ts …
// (src/*.ts is transformed, so parameter properties work too)
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

registerHooks({
  resolve(specifier, context, next) {
    let url = null;
    if (specifier.startsWith("@/")) url = pathToFileURL(path.join(root, "src", specifier.slice(2))).href;
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && !context.parentURL.includes("/node_modules/"))
      url = new URL(specifier, context.parentURL).href;
    if (url && !/\.(?:[cm]?[jt]sx?|json)$/.test(url)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        if (existsSync(fileURLToPath(url + ext))) return next(url + ext, context);
      }
    }
    return next(url ?? specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".json")) {
      return { format: "module", source: `export default ${readFileSync(fileURLToPath(url), "utf8")};`, shortCircuit: true };
    }
    // Repo sources may use TS-only syntax (parameter properties) that strip-only mode rejects.
    if (url.startsWith(pathToFileURL(path.join(root, "src")).href) && url.endsWith(".ts")) {
      const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform" });
      return { format: "module", source, shortCircuit: true };
    }
    return next(url, context);
  },
});
