import { spawn } from "node:child_process";

import type { CommandRunner } from "./contracts.ts";

const outputLimit = 2 * 1024 * 1024;

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.environment },
      stdio: "pipe",
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= outputLimit) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= outputLimit) stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("close", (status) => {
      resolve({
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });

export async function requireCommand(
  runner: CommandRunner,
  command: string,
  args: readonly string[],
  message: string,
) {
  const result = await runner(command, args);
  if (result.status !== 0) throw new Error(message);
  return result;
}
