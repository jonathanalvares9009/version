import { assertNotBare } from "../config/assert-not-bare";
import { assertInRepo } from "../file/assert-in-repo";
import { lsRecursive } from "../file/ls-recursive";
import { pathFromRepoRoot } from "../file/path-from-repo-root";
import { update_index } from "./update-index";

export const add = (path, _) => {
  assertInRepo();
  assertNotBare();

  // Get the paths of all the files matching path.
  const addedFiles = lsRecursive(path);

  // Abort if no files matched path.
  // Otherwise, use the update_index() Git command to actually add the files.
  if (addedFiles.length === 0) {
    throw new Error(pathFromRepoRoot(path) + " did not match any files");
  } else {
    addedFiles.forEach((p) => {
      update_index(p, { add: true });
    });
  }
};
