import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url) });

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function photoCraftHeadlessTransport(): "rpc" | "mcp" {
  const value = process.env.PHOTOCRAFT_HEADLESS_TRANSPORT?.trim() || "rpc";
  if (value !== "rpc" && value !== "mcp") {
    throw new Error("PHOTOCRAFT_HEADLESS_TRANSPORT harus berisi rpc atau mcp.");
  }
  return value;
}

export const env = {
  appId: required("APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  photocraftTmpdir: process.env.PHOTOCRAFT_TMPDIR?.trim() || "",
  photocraftHeadlessTransport: photoCraftHeadlessTransport(),
  vectorcraftCliBin: process.env.VECTORCRAFT_CLI_BIN?.trim() || "",
};
