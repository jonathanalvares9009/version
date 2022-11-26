import { objToStr } from "../config/obj-to-str";
import { inRepo } from "../file/in-repo";
import { writeFilesFromTree } from "../file/write-files-from-tree";

export const init = (opts) => {
  // Abort if already a repository.
  if (inRepo()) {
    return;
  }

  opts = opts || {};

  // Create a JS object that mirrors the Git basic directory structure.
  const versionStructure = {
    HEAD: "ref: refs/heads/master\n",

    // If --bare was passed, write to the Git config indicating that the repository is bare.
    // If --bare was not passed, write to the Git config saying the repository is not bare.
    config: objToStr({ core: { "": { bare: opts.bare === true } } }),

    objects: {},
    refs: {
      heads: {},
    },
  };

  // Write the standard Git directory structure using the versionStructure JS object.
  // If the repository is not bare, put the directories inside the .version directory.
  // If the repository is bare, put them in the top level of the repository.
  writeFilesFromTree(
    opts.bare ? versionStructure : { ".version": versionStructure },
    process.cwd()
  );
};
