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
