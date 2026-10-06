// PROPOSAL ONLY: canonical release packaging projections; no npm install/pack.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const owner = await import(pathToFileURL(path.resolve("scripts/lib/plugin-npm-package-manifest.mts")).href);
const params = { repoRoot: process.cwd(), packageDir: "extensions/nextcloud-talk", bundleDependencies: false };
const packageProjection = owner.resolveAugmentedPluginNpmPackageJson(params);
const manifestProjection = owner.resolveAugmentedPluginNpmManifest(params);
if (!packageProjection.packageJson || !manifestProjection.manifest) throw new Error("missing canonical publication projection");
const proof = path.join(process.env.RUNNER_TEMP!, "release-canary-proof");
const stockConfigs = owner.readGeneratedBundledChannelConfigs(path.join(proof,"stock-generated"));
const candidateConfigs = owner.readGeneratedBundledChannelConfigs(process.cwd());
const changedPluginConfigs = [...new Set([...stockConfigs.keys(),...candidateConfigs.keys()])].filter(id=>JSON.stringify(stockConfigs.get(id))!==JSON.stringify(candidateConfigs.get(id)));
if (changedPluginConfigs.length!==1 || changedPluginConfigs[0]!=="nextcloud-talk") throw new Error("unexpected generated plugin metadata delta: "+changedPluginConfigs.join(","));
fs.copyFileSync("src/config/bundled-channel-config-metadata.generated.ts",path.join(proof,"candidate-channel-config-metadata.generated.ts"));
fs.writeFileSync(path.join(proof,"generated-metadata-boundary.json"),JSON.stringify({changedPluginConfigs,status:"PASS"},null,2)+"\n");
const out = path.join(proof, "plugin-overlay");
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.resolve("extensions/nextcloud-talk/dist"), path.join(out, "dist"), { recursive: true });
fs.writeFileSync(path.join(out,"package.json"), JSON.stringify(packageProjection.packageJson,null,2)+"\n");
fs.writeFileSync(path.join(out,"openclaw.plugin.json"), JSON.stringify(manifestProjection.manifest,null,2)+"\n");
const walk = (dir: string): string[] => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
const files = walk(out);
for (const file of files.filter(p=>/\.(?:m|c)?js$/.test(p))) {
  const source=fs.readFileSync(file,"utf8");
  if (/(?:from\s*|import\s*\(|require\s*\()\s*["'](?:saxes|xmlchars)(?:\/[\w./-]*)?["']/.test(source)) throw new Error("unbundled XML parser import: "+file);
}
const hashes = Object.fromEntries(files.map(file=>[path.relative(out,file),{sha256:createHash("sha256").update(fs.readFileSync(file)).digest("hex"),bytes:fs.statSync(file).size}]));
fs.writeFileSync(path.join(proof,"plugin-artifact-manifest.json"),JSON.stringify({state:"COMPILED_PLUGIN_OVERLAY_NOT_LIVE_APPROVED",sourceRelease:"fc23bc864e4553c2d215e479eeec47b67a0bf943",files:hashes,canonicalOwner:"scripts/lib/plugin-npm-package-manifest.mts",runtimeDependenciesUnchanged:true},null,2)+"\n");
