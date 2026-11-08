// The port a run of the browser tests serves its test server on. Several
// runs can go at once on one machine — two worktrees, or a run beside a test
// server started by hand — so each takes a port of its own: the first one
// that no other run holds and nothing listens on. A run holds its port with
// a lock file naming its process, removed when it exits; a lock whose process
// is gone is free again.
import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { e2ePorts } from "@skjera/test";

/** Test servers' ports Dex lets log in, highest first. 8801 is left for a
 *  test server started by hand. */
export { e2ePorts };

const lockFile = (dir: string, port: number) =>
  join(dir, `skjera-e2e-${port}.lock`);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it exists, under another user.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Takes the lock on `port` for `pid`, or says it is held by a live process. */
export const tryLock = (dir: string, port: number, pid: number): boolean => {
  const file = lockFile(dir, port);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, String(pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(readFileSync(file, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return false;
      rmSync(file, { force: true });
    }
  }
  return false;
};

export const unlock = (dir: string, port: number): void =>
  rmSync(lockFile(dir, port), { force: true });

/** Whether something accepts connections on the port at localhost. */
export const listening = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });

/** The first of `ports` this process could lock and nothing listens on, held
 *  until the process exits. */
export const reservePort = async (
  options: {
    readonly dir?: string;
    readonly ports?: readonly number[];
    readonly pid?: number;
    readonly inUse?: (port: number) => Promise<boolean>;
  } = {},
): Promise<number> => {
  const {
    dir = tmpdir(),
    ports = e2ePorts,
    pid = process.pid,
    inUse = listening,
  } = options;
  for (const port of ports) {
    if (!tryLock(dir, port, pid)) continue;
    if (await inUse(port)) {
      unlock(dir, port);
      continue;
    }
    process.once("exit", () => unlock(dir, port));
    return port;
  }
  throw new Error(
    `Every port the browser tests can use (${ports.join(", ")}) is taken by another run or a test server; stop one and run again.`,
  );
};
