#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(__dirname, "../../..");
const sourceDir = resolve(projectRoot, "edgeone-pages");
const zipPath = resolve(projectRoot, "edgeone-pages-upload.zip");

if (!existsSync(sourceDir)) {
  throw new Error(`EdgeOne Pages source directory not found: ${sourceDir}`);
}

if (existsSync(zipPath)) {
  rmSync(zipPath);
}

console.log(`Packaging ${sourceDir}`);
execFileSync("tar", ["-a", "-c", "-f", zipPath, "-C", sourceDir, "."], {
  stdio: "inherit",
});

console.log(`Created ${zipPath}`);
