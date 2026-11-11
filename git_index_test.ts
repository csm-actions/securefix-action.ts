import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals } from "@std/assert";
import { isTracked } from "./git_index.ts";

// Ignore the user's and the system's git config.
Deno.env.set("GIT_CONFIG_GLOBAL", os.devNull);
Deno.env.set("GIT_CONFIG_NOSYSTEM", "1");

const git = (dir: string, ...args: string[]) => {
  execFileSync("git", args, { cwd: dir });
};

// withRepo runs fn in a new git repository and removes it afterwards.
// The repository tracks a file "file", a symlink "link", a file "dir/a.txt",
// and a file "[x]" whose name is a glob pattern.
const withRepo = (fn: (dir: string) => Promise<void>) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "securefix-index-test-"));
  try {
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "file"), "");
    fs.symlinkSync("file", path.join(dir, "link"));
    fs.mkdirSync(path.join(dir, "dir"));
    fs.writeFileSync(path.join(dir, "dir", "a.txt"), "");
    fs.writeFileSync(path.join(dir, "[x]"), "");
    git(dir, "add", ".");
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

Deno.test(
  "isTracked: tracked file and symlink replaced with directories",
  withRepo(async (dir) => {
    for (const name of ["file", "link"]) {
      fs.rmSync(path.join(dir, name));
      fs.mkdirSync(path.join(dir, name));
      fs.writeFileSync(path.join(dir, name, "a.txt"), "");
      assertEquals(await isTracked(dir, name), true);
    }
  }),
);

Deno.test(
  "isTracked: tracked directory",
  withRepo(async (dir) => {
    assertEquals(await isTracked(dir, "dir"), false);
  }),
);

Deno.test(
  "isTracked: untracked path",
  withRepo(async (dir) => {
    assertEquals(await isTracked(dir, "new"), false);
  }),
);

Deno.test(
  "isTracked: glob characters are literal",
  withRepo(async (dir) => {
    assertEquals(await isTracked(dir, "[x]"), true);
    assertEquals(await isTracked(dir, "[f]ile"), false);
  }),
);
