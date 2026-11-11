import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals, assertMatch, assertRejects } from "@std/assert";
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
  "getSubmoduleSHA: submodule added by git submodule add",
  withTmpDir(async (dir) => {
    const sha = initRepo(path.join(dir, "upstream"), "upstream\n");
    initRepo(path.join(dir, "parent"), "parent\n");
    git(
      path.join(dir, "parent"),
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      path.join(dir, "upstream"),
      "sub",
    );
    // .git of a submodule is a file pointing to .git/modules of the parent
    assertEquals(
      fs.statSync(path.join(dir, "parent", "sub", ".git")).isFile(),
      true,
    );
    assertEquals(await getSubmoduleSHA(path.join(dir, "parent", "sub")), sha);
  }),
);

Deno.test(
  "getSubmoduleSHA: nested directory in a submodule",
  withTmpDir(async (dir) => {
    initRepo(dir, "parent\n");
    initRepo(path.join(dir, "sub"), "sub\n");
    fs.mkdirSync(path.join(dir, "sub", "x"));
    assertEquals(await getSubmoduleSHA(path.join(dir, "sub", "x")), "");
  }),
);

Deno.test(
  "getSubmoduleSHA: git fails if HEAD doesn't exist",
  withTmpDir(async (dir) => {
    initRepo(dir, "parent\n");
    git(path.join(dir), "init", "-q", "unborn");
    await assertRejects(() => getSubmoduleSHA(path.join(dir, "unborn")));
  }),
);

Deno.test(
  "getSubmoduleSHA: git fails outside a repository",
  withTmpDir(async (dir) => {
    // Don't find a repository containing the temporary directory
    await withEnv("GIT_CEILING_DIRECTORIES", path.dirname(dir), async () => {
      await assertRejects(
        () => getSubmoduleSHA(dir),
        Error,
        `failed to check if a directory ${dir} is a submodule`,
      );
    });
  }),
);

Deno.test(
  "getSubmoduleSHA: GIT_DIR is ignored",
  withTmpDir(async (dir) => {
    initRepo(dir, "parent\n");
    fs.mkdirSync(path.join(dir, "x"));
    // With only GIT_DIR, git regards the current directory as the top level
    await withEnv("GIT_DIR", path.join(dir, ".git"), async () => {
      assertEquals(await getSubmoduleSHA(path.join(dir, "x")), "");
    });
  }),
);
