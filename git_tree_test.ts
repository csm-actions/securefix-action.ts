import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  findReplacedPaths,
  getTreeModes,
  listReplacedPathCandidates,
} from "./git_tree.ts";

// Ignore the user's and the system's git config.
Deno.env.set("GIT_CONFIG_GLOBAL", os.devNull);
Deno.env.set("GIT_CONFIG_NOSYSTEM", "1");

const git = (dir: string, ...args: string[]) => {
  execFileSync("git", args, { cwd: dir });
};

const commit = (dir: string) => {
  git(
    dir,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "commit",
  );
};

// withTmpDir runs fn in a new temporary directory and removes it afterwards.
const withTmpDir = (fn: (dir: string) => Promise<void>) => async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "securefix-tree-test-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// withEnv sets an environment variable while fn runs.
const withEnv = async (
  name: string,
  value: string,
  fn: () => Promise<void>,
) => {
  const old = Deno.env.get(name);
  Deno.env.set(name, value);
  try {
    await fn();
  } finally {
    if (old === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, old);
    }
  }
};

// setupRepo creates a repository whose HEAD has a file "file", an executable
// "exe", a symlink "link", a file "dir/a.txt", a file "[x]", and a submodule
// "sub".
const setupRepo = (dir: string) => {
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "file"), "");
  fs.writeFileSync(path.join(dir, "exe"), "");
  fs.chmodSync(path.join(dir, "exe"), 0o755);
  fs.symlinkSync("file", path.join(dir, "link"));
  fs.mkdirSync(path.join(dir, "dir"));
  fs.writeFileSync(path.join(dir, "dir", "a.txt"), "");
  fs.writeFileSync(path.join(dir, "[x]"), "");
  git(dir, "add", ".");
  git(
    dir,
    "update-index",
    "--add",
    "--cacheinfo",
    "160000,1111111111111111111111111111111111111111,sub",
  );
  commit(dir);
};

Deno.test(
  "getTreeModes: modes of the given paths in HEAD",
  withTmpDir(async (dir) => {
    setupRepo(dir);
    assertEquals(
      await getTreeModes(dir, [
        "file",
        "exe",
        "link",
        "dir/a.txt",
        "sub",
        "[x]",
        "[f]ile",
        "new",
      ]),
      new Map([
        ["file", "100644"],
        ["exe", "100755"],
        ["link", "120000"],
        ["dir/a.txt", "100644"],
        ["sub", "160000"],
        ["[x]", "100644"],
      ]),
    );
  }),
);

Deno.test(
  "getTreeModes: paths are relative to dir",
  withTmpDir(async (dir) => {
    setupRepo(dir);
    assertEquals(
      await getTreeModes(path.join(dir, "dir"), ["a.txt", "file"]),
      new Map([["a.txt", "100644"]]),
    );
  }),
);

Deno.test(
  "getTreeModes: a file removed by git rm is in HEAD",
  withTmpDir(async (dir) => {
    setupRepo(dir);
    git(dir, "rm", "-q", "file");
    fs.mkdirSync(path.join(dir, "file"));
    fs.writeFileSync(path.join(dir, "file", "x"), "");
    assertEquals(
      await getTreeModes(dir, ["file"]),
      new Map([["file", "100644"]]),
    );
  }),
);

Deno.test(
  "getTreeModes: a repository without commits",
  withTmpDir(async (dir) => {
    git(dir, "init", "-q");
    assertEquals(await getTreeModes(dir, ["file"]), new Map());
  }),
);

Deno.test(
  "getTreeModes: outside a repository",
  withTmpDir(async (dir) => {
    // Don't find a repository containing the temporary directory
    await withEnv("GIT_CEILING_DIRECTORIES", path.dirname(dir), async () => {
      assertEquals(
        await getTreeModes(dir, ["file"], { skipWithoutRepository: true }),
        new Map(),
      );
      await assertRejects(
        () => getTreeModes(dir, ["file"]),
        Error,
        "failed to check if",
      );
    });
  }),
);

Deno.test(
  "getTreeModes: in a git directory",
  withTmpDir(async (dir) => {
    setupRepo(dir);
    await assertRejects(
      () => getTreeModes(path.join(dir, ".git"), ["file"]),
      Error,
      "not in a work tree",
    );
    assertEquals(
      await getTreeModes(path.join(dir, ".git"), ["file"], {
        skipWithoutRepository: true,
      }),
      new Map(),
    );
  }),
);

Deno.test(
  "getTreeModes: git isn't installed",
  withTmpDir(async (dir) => {
    setupRepo(dir);
    // git can't be found
    await withEnv("PATH", dir, async () => {
      assertEquals(
        await getTreeModes(dir, ["file"], { skipWithoutRepository: true }),
        new Map(),
      );
      await assertRejects(() => getTreeModes(dir, ["file"]));
    });
  }),
);

Deno.test("listReplacedPathCandidates", () => {
  assertEquals(
    listReplacedPathCandidates(["d"], ["f/x", "f/y/z", "a.txt"]).sort(),
    ["d", "f", "f/y"],
  );
});

const modes = new Map([
  ["f", "100644"],
  ["exe", "100755"],
  ["link", "120000"],
  ["sub", "160000"],
  ["dir", "040000"],
]);

Deno.test("findReplacedPaths: files and symlinks are replaced", () => {
  assertEquals(
    findReplacedPaths(["f", "exe", "link", "dir", "new"], modes),
    ["f", "exe", "link"],
  );
});

Deno.test("findReplacedPaths: a submodule throws", () => {
  assertThrows(
    () => findReplacedPaths(["sub"], modes),
    Error,
    "sub is a submodule in HEAD. Paths under a submodule can't be committed",
  );
});
