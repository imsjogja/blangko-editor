import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) writeFileSync(to, readFileSync(from));
  }
}

const source = path.resolve("vendor/photocraft");
const target = path.resolve("dist/vendor/photocraft");
if (!existsSync(path.join(source, "photocraft-cli.gz"))) {
  throw new Error("Runtime PhotoCraft belum tersedia di vendor/photocraft.");
}
const metadata = JSON.parse(readFileSync(path.join(source, "RUNTIME.json"), "utf8"));
if (metadata.compatibility?.mode === "bundled-glibc-loader") {
  for (const library of metadata.sharedLibraries ?? []) {
    if (!existsSync(path.join(source, "glibc", `${library.name}.gz`))) {
      throw new Error(`Shared library runtime belum tersedia: ${library.name}.`);
    }
  }
  for (const notice of ["GLIBC-LICENSE.txt", "GCC-RUNTIME-LICENSE.txt"]) {
    if (!existsSync(path.join(source, notice))) throw new Error(`Lisensi runtime belum tersedia: ${notice}.`);
  }
}
mkdirSync(path.dirname(target), { recursive: true });
copyDirectory(source, target);
const fontSource = path.resolve("public/fonts");
if (!existsSync(path.join(fontSource, "Inter-Regular.ttf"))) {
  throw new Error("Font bundled belum tersedia di public/fonts.");
}
copyDirectory(fontSource, path.resolve("dist/fonts"));
console.log("PhotoCraft runtime dan font bundled disalin ke dist.");
