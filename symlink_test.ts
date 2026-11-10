import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertEquals } from "@std/assert";
import { isUnderSymlink, readSymlink } from "./symlink.ts";

const tmpDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "securefix-symlink-test-"));

Deno.test("readSymlink: resolvable symlink", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "dir"));
  fs.writeFileSync(path.join(dir, "shared.txt"), "hello\n");
  fs.symlinkSync("../shared.txt", path.join(dir, "dir", "link.txt"));
  assertEquals(readSymlink(path.join(dir, "dir", "link.txt")), "../shared.txt");
});

Deno.test("readSymlink: dangling symlink", () => {
  const dir = tmpDir();
  fs.symlinkSync("not-found.txt", path.join(dir, "link.txt"));
  assertEquals(readSymlink(path.join(dir, "link.txt")), "not-found.txt");
});

Deno.test("readSymlink: symlink to a directory", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "real"));
  fs.symlinkSync("real", path.join(dir, "link"));
  assertEquals(readSymlink(path.join(dir, "link")), "real");
});

Deno.test("readSymlink: regular file", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "file.txt"), "hello\n");
  assertEquals(readSymlink(path.join(dir, "file.txt")), undefined);
});

Deno.test("readSymlink: directory", () => {
  const dir = tmpDir();
  assertEquals(readSymlink(dir), undefined);
});

Deno.test("readSymlink: deleted file", () => {
  const dir = tmpDir();
  assertEquals(readSymlink(path.join(dir, "not-found.txt")), undefined);
});

Deno.test("isUnderSymlink: file in a symlinked directory", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "other"));
  fs.writeFileSync(path.join(dir, "other", "a.txt"), "hello\n");
  fs.symlinkSync("other", path.join(dir, "dir"));
  assertEquals(isUnderSymlink(dir, "dir/a.txt"), true);
  assertEquals(isUnderSymlink(dir, "dir/not-found.txt"), true);
});

Deno.test("isUnderSymlink: nested under a symlinked directory", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "other", "b"), { recursive: true });
  fs.mkdirSync(path.join(dir, "a"));
  fs.symlinkSync("../other", path.join(dir, "a", "dir"));
  assertEquals(isUnderSymlink(dir, "a/dir/b/c.txt"), true);
});

Deno.test("isUnderSymlink: the file itself is a symlink", () => {
  const dir = tmpDir();
  fs.symlinkSync("not-found.txt", path.join(dir, "link.txt"));
  assertEquals(isUnderSymlink(dir, "link.txt"), false);
});

Deno.test("isUnderSymlink: regular directories", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
  assertEquals(isUnderSymlink(dir, "a/b/c.txt"), false);
});

Deno.test("isUnderSymlink: deleted directory", () => {
  const dir = tmpDir();
  assertEquals(isUnderSymlink(dir, "a/b/c.txt"), false);
});

Deno.test("isUnderSymlink: a parent is a regular file", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "a"), "");
  assertEquals(isUnderSymlink(dir, "a/b/c.txt"), false);
});

Deno.test("isUnderSymlink: baseDir itself isn't checked", () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "real"));
  fs.symlinkSync("real", path.join(dir, "root"));
  assertEquals(isUnderSymlink(path.join(dir, "root"), "a.txt"), false);
});
