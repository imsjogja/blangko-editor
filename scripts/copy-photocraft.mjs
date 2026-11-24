import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const source = path.resolve("vendor/photocraft");
const target = path.resolve("dist/vendor/photocraft");
if (!existsSync(path.join(source, "photocraft-cli.gz"))) {
  throw new Error("Runtime PhotoCraft belum tersedia di vendor/photocraft.");
}
mkdirSync(path.dirname(target), { recursive: true });
cpSync(source, target, { recursive: true, force: true });
console.log("PhotoCraft runtime disalin ke dist/vendor/photocraft.");
