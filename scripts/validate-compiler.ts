import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import template from "./compiler-validation.config.json";

const root = process.cwd();
const backend = process.env.BACKEND ?? "";
const target = process.env.TARGET ?? "";
assert.ok(["baguette", "croissant", "crust"].includes(backend));
assert.equal(backend === "baguette" ? "wasm" : backend === "croissant" ? "clang" : "rust", target);
const compiler = path.join(root, ".compiler", backend);
const output = path.join(root, "build/compiler-validation", target);
execFileSync("mkdir", ["-p", output]);

const command = (args: [string, ...string[]], cwd = root): void => {
  execFileSync(args[0], args.slice(1), { cwd, stdio: "inherit" });
};
const git = (args: string[], cwd = root): string =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const revision = git(["rev-parse", "HEAD"]);
const hashes: Record<string, string> = {};
for (const source of git(["ls-files", "src"]).split("\n")) {
  hashes[source] = createHash("sha256").update(readFileSync(source)).digest("hex");
}
const receipt = {
  sourceRevision: revision, sourceTree: git(["rev-parse", "HEAD^{tree}"]),
  backend, backendRevision: git(["rev-parse", "HEAD"], compiler),
  bakeRevision: git(["rev-parse", "HEAD"], path.join(compiler, "bake")),
  sourceHashes: hashes,
};
writeFileSync(path.join(output, "provenance.json"), JSON.stringify(receipt, null, 2) + "\n");

if (target === "wasm") {
  const config = {
    ...template,
    project: path.resolve(template.project),
    entries: template.entries.map(entry => path.resolve(entry)),
    intrinsicModules: template.intrinsicModules.map(entry => path.resolve(entry)),
    generatedDir: path.resolve(template.generatedDir), outDir: path.resolve(template.outDir),
    variants: template.variants.map(variant => ({
      ...variant, preludeFile: path.resolve(variant.preludeFile),
    })),
    canonicalRevision: revision,
  };
  const configPath = path.join(output, "config.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  command([process.execPath, path.join(compiler, "src/compiler.ts"), "--config", configPath, "--emit-modular-wat"], compiler);
} else {
  command([process.execPath, path.join(compiler, "src/thistle-project.ts"), root]);
  const configPath = path.join(root, target === "clang" ? "tsconfig.croissant.json" : "tsconfig.crust.json");
  const project = readFileSync(configPath, "utf8");
  assert.ok(project.includes('"src/native/word.ts"'), "Pinned backend entry list changed");
  writeFileSync(configPath, project.replace('"src/native/word.ts"', [
    '"src/native/word.ts"', '"src/native/vfs-edit.ts"',
    '"src/native/process-state.ts"', '"src/native/process-reap.ts"',
    '"src/native/vfs-backing.ts"',
  ].join(",\n    ")));
  command([
    process.execPath, path.join(compiler, "bake/src/cli.ts"),
    "--project", configPath, "--out-dir", path.join(output, "bake"),
    "--target", target, "--engine", "host", "--fail-on-warnings",
    "--report", path.join(output, "bake-report.json"),
  ]);
  command([
    process.execPath, path.join(compiler, "src/cli.ts"),
    "--manifest", path.join(output, "bake/bake-manifest.json"),
    "--out-dir", path.join(output, "generated"),
  ]);
}
console.log("Canonical source validation:", JSON.stringify({ revision, backend, target }));
