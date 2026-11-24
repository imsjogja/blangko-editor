import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve("vendor/photocraft");
const target = path.resolve("dist/vendor/photocraft");
if (!existsSync(path.join(source, "photocraft-cli.gz"))) {
  throw new Error("Runtime PhotoCraft belum tersedia di vendor/photocraft.");
}
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true, force: true });
const fontSource = path.resolve("public/fonts");
if (!existsSync(path.join(fontSource, "Inter-Regular.ttf"))) {
  throw new Error("Font bundled belum tersedia di public/fonts.");
}
cpSync(fontSource, path.resolve("dist/fonts"), { recursive: true, force: true });
console.log("PhotoCraft runtime dan font bundled disalin ke dist.");
