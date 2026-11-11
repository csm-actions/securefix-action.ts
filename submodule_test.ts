import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals, assertMatch } from "@std/assert";
import { getSubmoduleSHA } from "./submodule.ts";

// Ignore the user's and the system's git config.
Deno.env.set("GIT_CONFIG_GLOBAL", os.devNull);
Deno.env.set("GIT_CONFIG_NOSYSTEM", "1");

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

// content must differ between repositories, otherwise commits created in
// the same second have the same SHA.
const initRepo = (dir: string, content: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "README.md"), content);
  git(dir, "add", ".");
  git(
    dir,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "init",
  );
  return git(dir, "rev-parse", "HEAD");
};

// withTmpDir runs fn in a new temporary directory and removes it afterwards.
const withTmpDir = (fn: (dir: string) => Promise<void>) => async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "securefix-submodule-test-"),
  );
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

Deno.test(
  "getSubmoduleSHA: nested repository",
  withTmpDir(async (dir) => {
    const parentSHA = initRepo(dir, "parent\n");
    const sha = initRepo(path.join(dir, "sub"), "sub\n");
    assertMatch(sha, /^[0-9a-f]{40}$/);
    assertEquals(await getSubmoduleSHA(path.join(dir, "sub")), sha);
    assertEquals(sha === parentSHA, false);
  }),
);

Deno.test(
  "getSubmoduleSHA: regular directory in a repository",
  withTmpDir(async (dir) => {
    initRepo(dir, "parent\n");
    fs.mkdirSync(path.join(dir, "x"));
    fs.writeFileSync(path.join(dir, "x", "a.txt"), "a\n");
    assertEquals(await getSubmoduleSHA(path.join(dir, "x")), "");
  }),
);

Deno.test(
  "getSubmoduleSHA: directory outside a repository",
  withTmpDir(async (dir) => {
    assertEquals(await getSubmoduleSHA(dir), "");
  }),
);
