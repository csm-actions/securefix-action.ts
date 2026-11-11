import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals, assertThrows } from "@std/assert";
import { findReplacedParents, getIndexModes } from "./git_index.ts";

// Ignore the user's and the system's git config.
Deno.env.set("GIT_CONFIG_GLOBAL", os.devNull);
Deno.env.set("GIT_CONFIG_NOSYSTEM", "1");

const git = (dir: string, ...args: string[]) => {
  execFileSync("git", args, { cwd: dir });
};

// withTmpDir runs fn in a new temporary directory and removes it afterwards.
const withTmpDir = (fn: (dir: string) => Promise<void>) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "securefix-index-test-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

Deno.test(
  "getIndexModes: files, symlinks, and submodules",
  withTmpDir(async (dir) => {
    git(dir, "init", "-q");
    fs.writeFileSync(path.join(dir, "file"), "");
    fs.writeFileSync(path.join(dir, "exe"), "");
    fs.chmodSync(path.join(dir, "exe"), 0o755);
    fs.symlinkSync("file", path.join(dir, "link"));
    fs.mkdirSync(path.join(dir, "dir"));
    fs.writeFileSync(path.join(dir, "dir", "a.txt"), "");
    git(dir, "add", ".");
    git(
      dir,
      "update-index",
      "--add",
      "--cacheinfo",
      "160000,1111111111111111111111111111111111111111,sub",
    );
    // A file replaced with a directory is still in the index
    fs.rmSync(path.join(dir, "file"));
    fs.mkdirSync(path.join(dir, "file"));
    assertEquals(
      await getIndexModes(dir),
      new Map([
        ["dir/a.txt", "100644"],
        ["exe", "100755"],
        ["file", "100644"],
        ["link", "120000"],
        ["sub", "160000"],
      ]),
    );
    // Paths are relative to dir
    assertEquals(
      await getIndexModes(path.join(dir, "dir")),
      new Map([["a.txt", "100644"]]),
    );
  }),
);

Deno.test(
  "getIndexModes: outside a repository",
  withTmpDir(async (dir) => {
    const old = Deno.env.get("GIT_CEILING_DIRECTORIES");
    Deno.env.set("GIT_CEILING_DIRECTORIES", path.dirname(dir));
    try {
      assertEquals(await getIndexModes(dir), new Map());
    } finally {
      if (old === undefined) {
        Deno.env.delete("GIT_CEILING_DIRECTORIES");
      } else {
        Deno.env.set("GIT_CEILING_DIRECTORIES", old);
      }
    }
  }),
);

const indexModes = new Map([
  ["f", "100644"],
  ["link", "120000"],
  ["sub", "160000"],
  ["dir/a.txt", "100644"],
]);

Deno.test("findReplacedParents: a file and a symlink replaced with directories", () => {
  assertEquals(
    findReplacedParents(
      ["f/x", "f/y/z", "link/a", "dir/b.txt", "new/c"],
      indexModes,
    ),
    ["f", "link"],
  );
});

Deno.test("findReplacedParents: the path itself isn't a parent", () => {
  // e.g. a file replaced with a symlink at the same path
  assertEquals(findReplacedParents(["f", "link"], indexModes), []);
});

Deno.test("findReplacedParents: a path under a submodule throws", () => {
  assertThrows(
    () => findReplacedParents(["sub/x"], indexModes),
    Error,
    "sub/x is under a submodule sub",
  );
});
