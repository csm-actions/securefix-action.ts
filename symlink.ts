import * as fs from "node:fs";

export type Symlink = {
  /** The path of the symlink relative to rootDir */
  path: string;
  /** The link target, i.e. the result of readlink(2) */
  target: string;
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
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!stats.isSymbolicLink()) {
    return undefined;
  }
  return fs.readlinkSync(filePath);
};
