import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const tauriConfig = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

for (const [source, version] of [
  ["src-tauri/tauri.conf.json", tauriConfig.version],
  ["src-tauri/Cargo.toml", cargoVersion]
]) {
  if (version !== packageJson.version) {
    throw new Error(
      `Version mismatch: package.json is ${packageJson.version}, but ${source} is ${version}.`
    );
  }
}

const commands = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "test:unit"]],
  ["npm", ["run", "test:e2e"]],
  ["npm", ["audit", "--audit-level=high"]],
  ["cargo", ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check"]],
  ["cargo", ["clippy", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings"]],
  ["cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["cargo", ["audit", "--file", "src-tauri/Cargo.lock"]],
  ["cargo", ["deny", "--manifest-path", "src-tauri/Cargo.toml", "check", "licenses", "bans", "sources"]]
];

for (const [command, args] of commands) {
  const executable = process.platform === "win32" && command === "npm"
    ? "npm.cmd"
    : command;
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: { ...process.env, CI: "true" },
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nVerityPDF v${packageJson.version} passed release verification.`);
