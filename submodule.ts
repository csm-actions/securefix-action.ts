import process from "node:process";
import * as exec from "@actions/exec";

// They make git use another repository or work tree than the one at dir.
// e.g. if only GIT_DIR is set, git regards the current directory as the top
// level, so every directory would look like a submodule.
const repositoryEnvNames = ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"];

/**
 * Returns the commit SHA of the submodule checked out at dir.
 * It returns an empty string if dir isn't the top level directory of a
 * Git repository, e.g. a regular directory which replaced a symlink or a file.
 *
 * `git -C <dir> rev-parse HEAD` alone can't tell them apart, because in a
 * regular directory it returns HEAD of the enclosing repository, which would
 * be committed as a bogus submodule.
 * `--show-prefix` outputs the path of dir from the top level directory,
 * which is empty only if dir is the top level directory.
 *
 * It throws an error if git fails, e.g. HEAD doesn't exist or the directory
 * is owned by another user (safe.directory).
 */
export const getSubmoduleSHA = async (dir: string): Promise<string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !repositoryEnvNames.includes(key)) {
      env[key] = value;
    }
  }
  let stdout: string;
  try {
    const result = await exec.getExecOutput(
      "git",
      ["-C", dir, "rev-parse", "--show-prefix", "HEAD"],
      { env },
    );
    stdout = result.stdout;
  } catch (error: unknown) {
    throw new Error(
      `failed to check if a directory ${dir} is a submodule: ${error}`,
      { cause: error },
    );
  }
  const [prefix, sha] = stdout.split("\n");
  if (prefix !== "") {
    return "";
  }
  return sha.trim();
};
