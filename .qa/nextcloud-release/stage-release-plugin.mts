import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const owner = await import(pathToFileURL(path.resolve("scripts/lib/plugin-npm-package-manifest.mts")).href);
const params = { repoRoot: process.cwd(), packageDir: "extensions/nextcloud-talk", bundleDependencies: false };
const result = owner.resolveAugmentedPluginNpmManifest(params);
if (!result.manifest) throw new Error("Missing canonical plugin manifest");
const proof = path.join(process.env.RUNNER_TEMP!, "nextcloud-release-proof");
const overlay = path.join(proof, "plugin-overlay");
fs.mkdirSync(overlay, { recursive: true });
fs.cpSync("extensions/nextcloud-talk/dist", path.join(overlay, "dist"), { recursive: true });
fs.writeFileSync(path.join(overlay, "openclaw.plugin.json"), JSON.stringify(result.manifest, null, 2) + "\n");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const files = walk(overlay);
for (const file of files.filter(p => /\.(?:m|c)?js$/.test(p))) {
  if (/(?:from\s*|import\s*\(|require\s*\()\s*["'](?:saxes|xmlchars)(?:\/[\w./-]*)?["']/.test(fs.readFileSync(file, "utf8"))) throw new Error("Unbundled XML parser: " + file);
}
const hashes = Object.fromEntries(files.map(file => [path.relative(overlay, file), { sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex"), bytes: fs.statSync(file).size }]));
fs.writeFileSync(path.join(proof, "plugin-artifact-manifest.json"), JSON.stringify({ release: "59cb44796b0f1f0daa0e37af8b1495abb45d9bc1", files: hashes, packageJsonMustRemainInstalledOfficial: true, requiresCoreSeam: true }, null, 2) + "\n");
