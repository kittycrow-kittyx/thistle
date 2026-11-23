import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = process.cwd();
const backend = process.env.BACKEND ?? "";
const target = process.env.TARGET ?? "";
assert.ok(["baguette", "croissant", "crust"].includes(backend));
assert.equal({ baguette: "wasm", croissant: "clang", crust: "rust" }[backend], target);
const compiler = path.join(root, ".compiler", backend);
const output = path.join(root, "build/compiler-validation", target);
await mkdir(output, { recursive: true });

const command = async (args: string[], cwd = root): Promise<void> => {
  const child = Bun.spawn(args, { cwd, stdout: "inherit", stderr: "inherit" });
  assert.equal(await child.exited, 0, args.join(" "));
};
const git = (args: string[], cwd = root): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd });
  assert.equal(result.exitCode, 0);
  return result.stdout.toString().trim();
};
const revision = git(["rev-parse", "HEAD"]);
const sourcePaths = git(["ls-files", "src"]).split("\n");
const hashes: Record<string, string> = {};
for (const source of sourcePaths) hashes[source] = createHash("sha256").update(await readFile(source)).digest("hex");
const receipt = {
  sourceRevision: revision,
  sourceTree: git(["rev-parse", "HEAD^{tree}"]),
  backend, backendRevision: git(["rev-parse", "HEAD"], compiler),
  bakeRevision: git(["rev-parse", "HEAD"], path.join(compiler, "bake")),
  sourceHashes: hashes,
};
await writeFile(path.join(output, "provenance.json"), JSON.stringify(receipt, null, 2) + "\n");

if (target === "wasm") {
  const config = JSON.parse(await readFile("scripts/compiler-validation.config.json", "utf8"));
  config.project = path.resolve(config.project);
  config.entries = config.entries.map((entry: string) => path.resolve(entry));
  config.intrinsicModules = config.intrinsicModules.map((entry: string) => path.resolve(entry));
  config.generatedDir = path.resolve(config.generatedDir);
  config.outDir = path.resolve(config.outDir);
  config.variants = config.variants.map((variant: { preludeFile: string }) => ({
    ...variant, preludeFile: path.resolve(variant.preludeFile),
  }));
  config.canonicalRevision = revision;
  const configPath = path.join(output, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  await command([process.execPath, path.join(compiler, "src/compiler.ts"), "--config", configPath, "--emit-modular-wat"], compiler);
} else {
  await command([process.execPath, path.join(compiler, "src/thistle-project.ts"), root]);
  const configPath = path.join(root, target === "clang" ? "tsconfig.croissant.json" : "tsconfig.crust.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  for (const source of ["src/native/vfs-edit.ts", "src/native/process-state.ts", "src/native/process-reap.ts"]) config.files.push(source);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  const { bake, printBakeResult } = await import(pathToFileURL(path.join(compiler, "bake/src/index.ts")).href);
  const result = bake({
    project: configPath, outDir: path.join(output, "bake"), target, engine: "host",
    validateOnly: false, failOnWarnings: true, wasmFile: null,
    reportFile: path.join(output, "bake-report.json"),
  });
  printBakeResult(result);
  assert.equal(result.success, true);
  assert.equal(result.diagnostics.length, 0, "Canonical kernel diagnostics must be empty");
  await command([
    process.execPath, path.join(compiler, "src/cli.ts"),
    "--manifest", path.join(output, "bake/bake-manifest.json"),
    "--out-dir", path.join(output, "generated"),
  ]);
}
console.log("Canonical source validation:", JSON.stringify({ revision, backend, target }));
