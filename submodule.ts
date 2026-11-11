import * as exec from "@actions/exec";

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
  const result = await exec.getExecOutput(
    "git",
    ["-C", dir, "rev-parse", "--show-prefix", "HEAD"],
  );
  const [prefix, sha] = result.stdout.split("\n");
  if (prefix !== "") {
    return "";
  }
  return sha.trim();
};
