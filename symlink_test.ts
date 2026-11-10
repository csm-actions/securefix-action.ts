import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { assertEquals } from "@std/assert";
import { readSymlink } from "./symlink.ts";

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
