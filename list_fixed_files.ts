import * as path from "node:path";
import * as exec from "@actions/exec";

/**
 * listFixedFiles returns a set of relative file paths from rootDir to fixed files.
 */
export const listFixedFiles = async (
  rootDir: string,
  files: Set<string>,
): Promise<Set<string>> => {
  const result = await exec.getExecOutput(
    "git",
    ["ls-files", "-z", "--modified", "--others", "--exclude-standard"].concat([
      ...files,
    ]),
    {
      cwd: rootDir || undefined,
    },
  );
  return new Set(
    result.stdout.split("\0").filter((file) => file.length > 0),
  );
};

/**
 * normalizeFixedFile normalizes a fixed file path, e.g. "./a/./b/" -> "a/b".
 * git ls-files lists an untracked nested repository with a trailing slash,
 * and files specified with useGit: false aren't normalized.
 * The Create a tree API rejects a path with a leading slash, a trailing slash,
 * or a "." or ".." component.
 *
 * It throws an error if the path points to rootDir itself (e.g. "."), or
 * outside rootDir (e.g. "../a", "/a"), which can't be committed.
 */
export const normalizeFixedFile = (file: string): string => {
  const normalized = path.posix.normalize(file).replace(/\/+$/, "");
  if (normalized === "" || normalized === ".") {
    throw new Error(
      `a fixed file must not be the root directory: ${JSON.stringify(file)}`,
    );
  }
  if (
    path.posix.isAbsolute(normalized) || normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(
      `a fixed file must be a relative path in the root directory: ${
        JSON.stringify(file)
      }`,
    );
  }
  return normalized;
};

/**
 * listDeletedDirs returns the listed directories which have no new paths
 * under them.
 *
 * A directory listed by git which isn't a submodule replaced a file or a
 * symlink. If paths are added under it, the server deletes the old file or
 * symlink because it's a file or a symlink in the base tree. Otherwise
 * (e.g. all files in it are ignored), it must be deleted as a deleted file.
 */
export const listDeletedDirs = (
  listedDirs: string[],
  newPaths: string[],
): string[] => {
  const parents = new Set<string>();
  for (const p of newPaths) {
    const elems = p.split("/");
    for (let i = 1; i < elems.length; i++) {
      parents.add(elems.slice(0, i).join("/"));
    }
  }
  return listedDirs.filter((dir) => !parents.has(dir));
};
