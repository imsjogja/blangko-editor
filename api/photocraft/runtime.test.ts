import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialDocument } from "@contracts/invitation";
import { probePhotoCraft, runPhotoCraftHandoff } from "./runtime";

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const fixtureDirectories: string[] = [];

async function createFakeCli(behavior: "success" | "failure" | "timeout", appImage = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "blangko-cli-test-"));
  fixtureDirectories.push(directory);
  const binaryPath = path.join(directory, appImage ? "photocraft.AppImage" : "photocraft.cjs");
  const argsPath = path.join(directory, "arguments.json");
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--cli") args.shift();
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(args));
if (args[0] === "--version") {
  console.log("PhotoCraft CLI test 1.0");
  process.exit(0);
}
if (${JSON.stringify(behavior)} === "failure") {
  console.error("synthetic CLI failure");
  process.exit(9);
}
if (${JSON.stringify(behavior)} === "timeout") {
  setTimeout(() => process.exit(0), 5000);
} else {
  const outputIndex = args.indexOf("--out");
  fs.copyFileSync(args[1], args[outputIndex + 1]);
}
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return { binaryPath, argsPath };
}

function handoffOptions(binaryPath: string, timeoutMs?: number) {
  return {
    document: createInitialDocument(),
    sideId: "outside" as const,
    projection: "content-only" as const,
    pngBase64: PNG_1X1,
    binaryPath,
    timeoutMs,
  };
}

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("PhotoCraft CLI runtime", () => {
  it("melaporkan binary yang tidak tersedia tanpa melempar error", async () => {
    const status = await probePhotoCraft(path.join(tmpdir(), "photocraft-binary-tidak-ada"));
    expect(status.available).toBe(false);
    expect(status.editableLayers).toBe(false);
    expect(status.message).toContain("PHOTOCRAFT_CLI_BIN");
  });

  it("menambahkan prefix --cli untuk AppImage dan membaca versi", async () => {
    const fake = await createFakeCli("success", true);
    const status = await probePhotoCraft(fake.binaryPath);
    expect(status.available).toBe(true);
    expect(status.version).toBe("PhotoCraft CLI test 1.0");
    expect(JSON.parse(await readFile(fake.argsPath, "utf8"))).toEqual(["--version"]);
  });

  it("menjalankan handoff tanpa shell, menghasilkan manifest, dan membersihkan direktori sementara", async () => {
    const fake = await createFakeCli("success");
    const result = await runPhotoCraftHandoff(handoffOptions(fake.binaryPath));
    const args = JSON.parse(await readFile(fake.argsPath, "utf8")) as string[];
    expect(args[0]).toBe("run");
    expect(args[2]).toBe("--out");
    expect(args[1]).toContain("canvas.png");
    expect(result.fileBase64).toBe(PNG_1X1);
    expect(result.runtime).toBe("PhotoCraft CLI test 1.0");
    expect(result.manifest).toMatchObject({ schema: "blangko.photocraft.semantic.v1" });
    expect(result.editableLayers).toBe(false);
    expect(existsSync(path.dirname(args[1]))).toBe(false);
  });

  it("membersihkan direktori sementara ketika CLI gagal", async () => {
    const fake = await createFakeCli("failure");
    await expect(runPhotoCraftHandoff(handoffOptions(fake.binaryPath))).rejects.toThrow("synthetic CLI failure");
    const args = JSON.parse(await readFile(fake.argsPath, "utf8")) as string[];
    expect(existsSync(path.dirname(args[1]))).toBe(false);
  });

  it("menghentikan proses yang melewati timeout dan tetap membersihkan file", async () => {
    const fake = await createFakeCli("timeout");
    await expect(runPhotoCraftHandoff(handoffOptions(fake.binaryPath, 40))).rejects.toThrow("batas waktu");
    const args = JSON.parse(await readFile(fake.argsPath, "utf8")) as string[];
    expect(existsSync(path.dirname(args[1]))).toBe(false);
  });
});
