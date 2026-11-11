import * as exec from "@actions/exec";

/**
 * Returns true if the file is tracked in the index of the repository at dir.
 *
 * file is a relative path from dir. A file under the path doesn't count,
 * so it returns false for a tracked directory.
 * It's used to know if a directory replaced a tracked file, symlink, or
 * submodule, because the index has no entry for a directory itself.
 */
export const isTracked = async (
  dir: string,
  file: string,
): Promise<boolean> => {
  const result = await exec.getExecOutput(
    "git",
    ["--literal-pathspecs", "-C", dir, "ls-files", "-z", "--", file],
    { silent: true },
  );
  return result.stdout.split("\0").includes(file);
};
