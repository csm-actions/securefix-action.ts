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
 * normalizeFixedFile removes trailing slashes from a fixed file path.
 * git ls-files lists an untracked nested repository with a trailing slash.
 *
 * It throws an error if the path points to rootDir itself, e.g. "." specified
 * in files with useGit: false, which would be sent as a submodule at "."
 * and rejected by the Create a tree API.
 */
export const normalizeFixedFile = (file: string): string => {
  const normalized = file.replace(/\/+$/, "");
  if (["", "."].includes(path.posix.normalize(normalized || "."))) {
    throw new Error(
      `a fixed file must not be the root directory: ${JSON.stringify(file)}`,
    );
  }
  return normalized;
};
