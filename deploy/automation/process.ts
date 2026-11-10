import { execFileSync, spawnSync } from "node:child_process";

// Never include stdin in error messages: it can contain credentials or secrets.
export function run(
  command: string,
  args: string[],
  input?: string | Buffer,
  cwd?: string,
): Buffer {
  const result = spawnSync(command, args, {
    input,
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed (exit ${result.status})`);
  return result.stdout;
}

export function output(command: string, args: string[], cwd?: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}
