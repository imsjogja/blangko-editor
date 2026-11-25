import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metadata = JSON.parse(readFileSync(path.join(appRoot, "vendor/photocraft-fork/source.json"), "utf8"));
const buildRoot = process.env.PHOTOCRAFT_BUILD_ROOT || path.join(os.tmpdir(), "blangko-photocraft-fork");
const source = process.env.PHOTOCRAFT_SOURCE || path.join(buildRoot, "source");
const target = process.env.CARGO_TARGET_DIR || path.join(buildRoot, "target");
const output = path.join(appRoot, metadata.output);
const marker = path.join(source, ".blangko-upstream-commit");

function copyDirectory(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else if (entry.isFile()) {
      const content = readFileSync(sourcePath);
      // Preserve mtimes so a tool-download retry does not recompile unchanged Rust sources.
      if (!existsSync(targetPath) || !readFileSync(targetPath).equals(content)) {
        writeFileSync(targetPath, content);
      }
    }
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

async function downloadSource() {
  mkdirSync(buildRoot, { recursive: true });
  if (existsSync(marker)) {
    if (readFileSync(marker, "utf8").trim() !== metadata.upstreamCommit) {
      throw new Error(`Build source memakai commit berbeda: ${source}`);
    }
    return;
  }
  if (existsSync(source)) throw new Error(`Direktori build belum kosong: ${source}`);
  const archive = path.join(buildRoot, `${metadata.upstreamCommit}.tar.gz`);
  if (!existsSync(archive)) {
    const url = `https://codeload.github.com/storytold/photocraft/tar.gz/${metadata.upstreamCommit}`;
    console.log(`Mengunduh PhotoCraft ${metadata.upstreamCommit}…`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unduhan upstream gagal: HTTP ${response.status}`);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
  }
  mkdirSync(source, { recursive: true });
  run("tar", ["-xzf", archive, "-C", source, "--strip-components=1"]);
  writeFileSync(marker, `${metadata.upstreamCommit}\n`);
}

if (!process.env.PHOTOCRAFT_SOURCE) await downloadSource();
for (const directory of ["apps/photocraft-web"]) {
  copyDirectory(
    path.join(appRoot, "vendor/photocraft-fork", directory),
    path.join(source, directory),
  );
}

const webRoot = path.join(source, "apps/photocraft-web");
const trunk = process.env.TRUNK || "trunk";
const buildEnv = {
  ...process.env,
  CARGO_TARGET_DIR: target,
  CARGO_NET_RETRY: process.env.CARGO_NET_RETRY || "5",
  CARGO_NET_GIT_FETCH_WITH_CLI: process.env.CARGO_NET_GIT_FETCH_WITH_CLI || "true",
};

const rawWasm = path.join(target, "wasm32-unknown-unknown", "wasm-release", "photocraft-web.wasm");
const preoptWasm = path.join(target, "photocraft-web-preopt.wasm");
const cachedPreopt = process.env.PHOTOCRAFT_PREOPT_WASM;

if (cachedPreopt) {
  console.log("Memakai checkpoint WASM yang sudah di-pra-optimasi…");
  mkdirSync(path.dirname(rawWasm), { recursive: true });
  copyFileSync(cachedPreopt, rawWasm);
} else {
  console.log("Mengompilasi PhotoCraft WASM release…");
  run(process.env.CARGO || "cargo", [
    "build",
    "--package", "photocraft-web",
    "--target", "wasm32-unknown-unknown",
    "--profile", "wasm-release",
  ], { cwd: webRoot, env: buildEnv });

  // wasm-bindgen can need several times the input size in memory. A single O1
  // pass removes most dead IR before bindgen; optimizing only the raw 156 MB
  // module afterwards is too late and can OOM the build worker.
  const wasmOpt = process.env.WASM_OPT || "wasm-opt";
  const artifactDir = process.env.PHOTOCRAFT_WASM_ARTIFACT_DIR;
  if (artifactDir) {
    mkdirSync(artifactDir, { recursive: true });
    copyFileSync(rawWasm, path.join(artifactDir, "photocraft-web-raw.wasm"));
  }
  console.log("Pra-optimasi WASM sebelum wasm-bindgen…");
  run(wasmOpt, ["-O1", rawWasm, "-o", preoptWasm], { env: buildEnv });
  if (artifactDir) {
    copyFileSync(preoptWasm, path.join(artifactDir, "photocraft-web-preopt.wasm"));
  }
  copyFileSync(preoptWasm, `${rawWasm}.preopt`);
  renameSync(`${rawWasm}.preopt`, rawWasm);
}

console.log("Mengemas PhotoCraft WASM release…");
run(trunk, ["build", "--release", "--dist", output], {
  cwd: webRoot,
  env: buildEnv,
});
rmSync(path.join(output, ".trunk-lock"), { force: true });

copyDirectory(path.join(appRoot, "public/fonts"), path.join(output, "fonts"));
for (const notice of ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE", "ATTRIBUTION.md"]) {
  writeFileSync(path.join(output, notice), readFileSync(path.join(source, notice)));
}
writeFileSync(path.join(output, "fork.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`PhotoCraft WASM dan font tersedia di ${output}.`);

// The release output is a build artifact when this script is run locally; only
// remove a caller-provided temporary checkout, never the app's committed assets.
if (process.env.PHOTOCRAFT_CLEAN_SOURCE === "1" && !process.env.PHOTOCRAFT_SOURCE) {
  rmSync(source, { recursive: true, force: true });
}
