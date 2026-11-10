import * as fs from "node:fs";
import * as exec from "@actions/exec";

/**
 * Returns the commit SHA of the submodule checked out at dir.
 * It returns an empty string if dir isn't the top level directory of a
 * Git repository, e.g. a regular directory which replaced a symlink or a file.
 *
 * `git -C <dir> rev-parse HEAD` alone can't tell them apart, because in a
 * regular directory it returns HEAD of the enclosing repository, which would
 * be committed as a bogus submodule.
 */
export const getSubmoduleSHA = async (dir: string): Promise<string> => {
  const toplevel = await exec.getExecOutput(
    "git",
    ["-C", dir, "rev-parse", "--show-toplevel"],
    { ignoreReturnCode: true, silent: true },
  );
  if (toplevel.exitCode !== 0) {
    return "";
  }
  if (fs.realpathSync(toplevel.stdout.trim()) !== fs.realpathSync(dir)) {
    return "";
  }
  const head = await exec.getExecOutput(
    "git",
    ["-C", dir, "rev-parse", "HEAD"],
    { ignoreReturnCode: true, silent: true },
  );
  if (head.exitCode !== 0) {
    return "";
  }
  return head.stdout.trim();
};
