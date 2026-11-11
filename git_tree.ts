import * as core from "@actions/core";
import * as exec from "@actions/exec";

/** The mode of a submodule (gitlink) in a tree */
export const gitlinkMode = "160000";

// Modes of entries which can't contain other paths, except a submodule
const fileModes = ["100644", "100755", "120000"];

// The number of paths passed to one git command, to avoid too long arguments
const chunkSize = 500;

export type TreeModesOptions = {
  /**
   * Return an empty map if git can't tell that dir is in a Git work tree for
   * any reason, e.g. git isn't installed or dir isn't in a repository.
   * It's used with useGit: false, which doesn't require git otherwise.
   * Otherwise it throws an error.
   */
  skipWithoutRepository?: boolean;
};

/**
 * Returns the modes of the given paths in the tree of HEAD, keyed by the path
 * from dir. Paths which aren't in the tree aren't included.
 * e.g. "100644" for a file, "120000" for a symlink, "160000" for a submodule,
 * "040000" for a directory.
 *
 * The tree of HEAD is used instead of the index, because the server creates
 * a commit on top of a commit, so a path to delete must be in the committed
 * tree. e.g. a file removed by `git rm` isn't in the index but is in the tree.
 * The tree also has no conflict stages unlike the index.
 */
export const getTreeModes = async (
  dir: string,
  paths: string[],
  opts?: TreeModesOptions,
): Promise<Map<string, string>> => {
  const modes = new Map<string, string>();
  if (paths.length === 0) {
    return modes;
  }
  let workTreeError = "";
  try {
    const workTree = await exec.getExecOutput(
      "git",
      ["-C", dir, "rev-parse", "--is-inside-work-tree"],
      { ignoreReturnCode: true, silent: true },
    );
    if (workTree.exitCode !== 0) {
      workTreeError = workTree.stderr.trim();
    } else if (workTree.stdout.trim() !== "true") {
      workTreeError = "not in a work tree";
    }
  } catch (error: unknown) {
    // e.g. git isn't installed
    workTreeError = `${error}`;
  }
  if (workTreeError) {
    if (opts?.skipWithoutRepository) {
      core.info(
        `Skip detecting files or symlinks replaced with directories, because ${dir} isn't in a Git work tree: ${workTreeError}`,
      );
      return modes;
    }
    throw new Error(
      `failed to check if ${dir} is in a Git work tree: ${workTreeError}`,
    );
  }
  const head = await exec.getExecOutput(
    "git",
    ["-C", dir, "rev-parse", "--verify", "--quiet", "HEAD"],
    { ignoreReturnCode: true, silent: true },
  );
  if (head.exitCode !== 0) {
    // No commit yet, so nothing is committed
    return modes;
  }
  const wanted = new Set(paths);
  for (let i = 0; i < paths.length; i += chunkSize) {
    let stdout: string;
    try {
      const result = await exec.getExecOutput(
        "git",
        ["--literal-pathspecs", "-C", dir, "ls-tree", "-z", "HEAD", "--"]
          .concat(paths.slice(i, i + chunkSize)),
        { silent: true },
      );
      stdout = result.stdout;
    } catch (error: unknown) {
      throw new Error(`failed to list the tree of HEAD in ${dir}: ${error}`, {
        cause: error,
      });
    }
    for (const entry of stdout.split("\0")) {
      // <mode> SP <type> SP <object> TAB <path>
      const tab = entry.indexOf("\t");
      if (tab === -1) {
        continue;
      }
      const p = entry.slice(tab + 1);
      if (wanted.has(p)) {
        modes.set(p, entry.slice(0, entry.indexOf(" ")));
      }
    }
  }
  return modes;
};

/**
 * Returns the paths to check with getTreeModes: listed directories and the
 * parent directories of new paths.
 */
export const listReplacedPathCandidates = (
  dirs: string[],
  newPaths: string[],
): string[] => {
  const candidates = new Set(dirs);
  for (const p of newPaths) {
    for (const parent of parentDirs(p)) {
      candidates.add(parent);
    }
  }
  return [...candidates];
};

/**
 * Returns files or symlinks in the tree of HEAD replaced with directories.
 * They must be deleted explicitly to add paths under them, because the
 * Create a tree API can't add a path under a file or a symlink.
 *
 * candidates are listed directories which aren't submodules, and parent
 * directories of paths which will exist after the commit.
 * It throws an error if a candidate is a submodule, because replacing a
 * submodule with a directory isn't supported: git lists nothing in that case,
 * and a submodule which isn't checked out (an empty directory) can't be told
 * apart, so deleting it would delete the submodule.
 */
export const findReplacedPaths = (
  candidates: string[],
  modes: Map<string, string>,
): string[] => {
  const replaced: string[] = [];
  for (const p of candidates) {
    const mode = modes.get(p);
    if (mode === gitlinkMode) {
      throw new Error(
        `${p} is a submodule in HEAD. ` +
          "Paths under a submodule can't be committed, and replacing a submodule with a directory isn't supported",
      );
    }
    if (mode !== undefined && fileModes.includes(mode)) {
      replaced.push(p);
    }
  }
  return replaced;
};

// parentDirs("a/b/c") returns ["a", "a/b"].
const parentDirs = (file: string): string[] => {
  const elems = file.split("/");
  return elems.slice(1).map((_, i) => elems.slice(0, i + 1).join("/"));
};
