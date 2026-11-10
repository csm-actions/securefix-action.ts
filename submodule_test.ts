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

const initRepo = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "README.md"), "hello\n");
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

const tmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "securefix-submodule-test-"));

Deno.test("getSubmoduleSHA: nested repository", async () => {
  const dir = tmpDir();
  const parentSHA = initRepo(dir);
  const sha = initRepo(path.join(dir, "sub"));
  assertMatch(sha, /^[0-9a-f]{40}$/);
  assertEquals(await getSubmoduleSHA(path.join(dir, "sub")), sha);
  assertEquals(sha === parentSHA, false);
});

Deno.test("getSubmoduleSHA: regular directory in a repository", async () => {
  const dir = tmpDir();
  initRepo(dir);
  fs.mkdirSync(path.join(dir, "x"));
  fs.writeFileSync(path.join(dir, "x", "a.txt"), "a\n");
  assertEquals(await getSubmoduleSHA(path.join(dir, "x")), "");
});

Deno.test("getSubmoduleSHA: directory outside a repository", async () => {
  const dir = tmpDir();
  assertEquals(await getSubmoduleSHA(dir), "");
});
