import { assertNotBare } from "../config/assert-not-bare";
import { assertInRepo } from "../file/assert-in-repo";
import { matchingFiles } from "../index/matching-files";
import { pathFromRepoRoot } from "../file/path-from-repo-root";
import { update_index } from "./update-index";
import { fs } from "fs";
import { intersection } from "../utility/intersection";
import { addedOrModifiedFiles } from "../diff/added-or-modified-files";
import { workingCopyPath } from "../file/working-copy-path";

export const rm = (path, opts) => {
  assertInRepo();
  assertNotBare();
  opts = opts || {};

  // Get the paths of all files in the index that match path.
  const filesToRm = matchingFiles(path);

  // Abort if -f was passed. The removal of files with changes is not supported.
  // Abort if no files matched path.
  // Abort if path is a directory and -r was not passed.
  if (opts.f) {
    throw new Error("unsupported");
  } else if (filesToRm.length === 0) {
    throw new Error(pathFromRepoRoot(path) + " did not match any files");
  } else if (
    fs.existsSync(path) &&
    fs.statSync(path).isDirectory() &&
    !opts.r
  ) {
    throw new Error("not removing " + path + " recursively without -r");
  } else {
    // Get a list of all files that are to be removed and have also been changed on disk. If this list is not empty then abort.

    const changesToRm = intersection(addedOrModifiedFiles(), filesToRm);
    if (changesToRm.length > 0) {
      throw new Error(
        "these files have changes:\n" + changesToRm.join("\n") + "\n"
      );

      // Otherwise, remove the files that match path. Delete them from disk and remove from the index.
    } else {
      filesToRm
        .map(workingCopyPath)
        .filter(fs.existsSync)
        .forEach(fs.unlinkSync);
      filesToRm.forEach((p) => {
        update_index(p, { remove: true });
      });
    }
  }
};
