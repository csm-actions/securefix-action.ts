import * as exec from "@actions/exec";

/** The mode of a submodule (gitlink) in the index */
export const gitlinkMode = "160000";

/**
 * Returns the modes of the index entries under dir, keyed by the path from dir.
 * e.g. "100644" for a file, "120000" for a symlink, "160000" for a submodule.
 *
 * The index has no entry for a directory itself, so a path which is in the
 * index but is a directory on disk replaced a tracked file, symlink, or
 * submodule.
 *
 * It returns an empty map if dir isn't in a Git work tree, e.g. files are
 * specified with useGit: false outside a repository, because nothing is
 * tracked then.
 */
export const getIndexModes = async (
  dir: string,
): Promise<Map<string, string>> => {
  const workTree = await exec.getExecOutput(
    "git",
    ["-C", dir, "rev-parse", "--is-inside-work-tree"],
    { ignoreReturnCode: true, silent: true },
  );
  if (workTree.exitCode !== 0 || workTree.stdout.trim() !== "true") {
    return new Map();
  }
  let stdout: string;
  try {
    const result = await exec.getExecOutput(
      "git",
      ["-C", dir, "ls-files", "--stage", "-z"],
      { silent: true },
    );
    stdout = result.stdout;
  } catch (error: unknown) {
    throw new Error(`failed to list the index entries in ${dir}: ${error}`, {
      cause: error,
    });
  }
  const modes = new Map<string, string>();
  for (const entry of stdout.split("\0")) {
    // <mode> SP <object> SP <stage> TAB <path>
    const tab = entry.indexOf("\t");
    if (tab === -1) {
      continue;
    }
    modes.set(entry.slice(tab + 1), entry.slice(0, entry.indexOf(" ")));
  }
  return modes;
};

/**
 * Returns parent directories of the paths which are tracked as files or
 * symlinks, i.e. tracked files or symlinks replaced with directories.
 * They must be deleted explicitly to add the paths, because the Create a tree
 * API can't add a path under a file or a symlink.
 *
 * paths are paths which will exist after the commit. It throws an error if
 * a path is under a submodule, because replacing a submodule with a directory
 * isn't supported.
 */
export const findReplacedParents = (
  paths: string[],
  indexModes: Map<string, string>,
): string[] => {
  const parents = new Set<string>();
  for (const file of paths) {
    for (const parent of parentDirs(file)) {
      const mode = indexModes.get(parent);
      if (mode === undefined) {
        continue;
      }
      if (mode === gitlinkMode) {
        throw new Error(
          `${file} is under a submodule ${parent}. ` +
            "Replacing a submodule with a directory isn't supported",
        );
      }
      parents.add(parent);
    }
  }
  return [...parents];
};

// parentDirs("a/b/c") returns ["a", "a/b"].
const parentDirs = (file: string): string[] => {
  const elems = file.split("/");
  return elems.slice(1).map((_, i) => elems.slice(0, i + 1).join("/"));
};
