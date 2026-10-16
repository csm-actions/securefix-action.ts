import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { assertEquals } from "@std/assert";
import { listFixedFiles } from "./list_fixed_files.ts";

// Ignore the user's and the system's git config,
// e.g. core.quotePath=false would hide the quoting issue.
Deno.env.set("GIT_CONFIG_GLOBAL", os.devNull);
Deno.env.set("GIT_CONFIG_NOSYSTEM", "1");

const git = (dir: string, ...args: string[]) => {
  execFileSync("git", args, { cwd: dir });
};

const write = (dir: string, file: string, content = "") => {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

// setup creates a git repository with tracked files and returns its path.
// Files are only added to the index, which is enough for git ls-files --modified.
const setup = (tracked: string[]): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "securefix-test-"));
  git(dir, "init", "-q");
  for (const file of tracked) {
    write(dir, file, "old\n");
  }
  if (tracked.length > 0) {
    git(dir, "add", "--", ...tracked);
  }
  return dir;
};

const sorted = (files: Set<string>): string[] => [...files].sort();

Deno.test("no changes", async () => {
  const dir = setup(["a.txt"]);
  try {
    assertEquals(sorted(await listFixedFiles(dir, new Set())), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

Deno.test("modified, untracked, and deleted files", async () => {
  const dir = setup(["modified.txt", "deleted.txt", "unchanged.txt"]);
  try {
    write(dir, "modified.txt", "new\n");
    fs.rmSync(path.join(dir, "deleted.txt"));
    write(dir, "untracked.txt");
    write(dir, "ignored.txt");
    write(dir, ".gitignore", "ignored.txt\n");
    assertEquals(sorted(await listFixedFiles(dir, new Set())), [
      ".gitignore",
      "deleted.txt",
      "modified.txt",
      "untracked.txt",
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// https://github.com/csm-actions/securefix-action/issues/859
Deno.test("paths that git quotes by default", async () => {
  const dir = setup(["削除.txt"]);
  try {
    fs.rmSync(path.join(dir, "削除.txt"));
    const files = ["±.txt", "日本語.txt", 'a"b.txt', "a\\b.txt", " space .txt"];
    for (const file of files) {
      write(dir, file);
    }
    assertEquals(
      sorted(await listFixedFiles(dir, new Set())),
      [...files, "削除.txt"].sort(),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

Deno.test("files are passed to git ls-files as pathspecs", async () => {
  const dir = setup([]);
  try {
    write(dir, "foo/a.txt");
    write(dir, "foo/b.md");
    write(dir, "bar/c.txt");
    assertEquals(
      sorted(await listFixedFiles(dir, new Set(["foo/*.txt", "bar"]))),
      ["bar/c.txt", "foo/a.txt"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

Deno.test("paths are relative to rootDir", async () => {
  const dir = setup([]);
  try {
    write(dir, "sub/a.txt");
    write(dir, "other.txt");
    assertEquals(
      sorted(await listFixedFiles(path.join(dir, "sub"), new Set())),
      ["a.txt"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
