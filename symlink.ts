import * as fs from "node:fs";
import * as path from "node:path";

export type Symlink = {
  /** The path of the symlink relative to rootDir */
  path: string;
  /** The link target, i.e. the result of readlink(2) */
  target: string;
};

/**
 * Returns true if a parent directory of the file is a symlink.
 *
 * file is a relative path from baseDir, and baseDir itself isn't checked.
 *
 * Git doesn't follow symlinks, so when a directory is replaced with a symlink,
 * files in the directory are deleted from Git's point of view.
 * But fs.existsSync and fs.lstatSync follow the symlink, so they can find
 * files in the link target, which mustn't be committed under the symlink.
 */
export const isUnderSymlink = (baseDir: string, file: string): boolean => {
  const elems = file.split("/");
  let p = baseDir;
  for (const elem of elems.slice(0, -1)) {
    p = path.join(p, elem);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(p);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return false;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      return true;
    }
  }
  return false;
};

/**
 * Returns the link target if the file is a symlink, otherwise undefined.
 *
 * Symlinks can't be sent as files, because @actions/artifact dereferences
 * them on upload and unzip-stream writes every entry as a regular file on
 * download. So the link target is sent in the metadata file instead, and
 * the server commits it as a tree entry with mode 120000.
 *
 * lstat is used so that dangling symlinks aren't mistaken for deleted files.
 */
export const readSymlink = (filePath: string): string | undefined => {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // ENOTDIR: a parent directory was replaced with a regular file
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
  if (!stats.isSymbolicLink()) {
    return undefined;
  }
  return fs.readlinkSync(filePath);
};
