export const version = {
  // init() initializes the current directory as a new repository.
  init: (opts) => {
    // Abort if already a repository.
    if (files.inRepo()) {
      return;
    }
    opts = opts || {};

    // Create a JS object that mirrors the Git basic directory structure.
    const versionStructure = {
      HEAD: "ref: refs/heads/master\n",
      // If --bare was passed, write to the Git config indicating that the repository is bare.
      // If --bare was not passed, write to the Git config saying the repository is not bare.
      config: config.objToStr({ core: { "": { bare: opts.bare === true } } }),
      objects: {},
      refs: {
        heads: {},
      },
    };

    // Write the standard Git directory structure using the versionStructure JS object.
    // If the repository is not bare, put the directories inside the .version directory.
    // If the repository is bare, put them in the top level of the repository.
    files.writeFilesFromTree(
      opts.bare ? versionStructure : { ".version": versionStructure },
      process.cwd()
    );
  },

  // add() adds files that match path to the index.
  add: (path, _) => {
    files.assertInRepo();
    config.assertNotBare();

    // Get the paths of all the files matching path.
    const addedFiles = files.lsRecursive(path);

    // Abort if no files matched path.
    // Otherwise, use the update_index() Git command to actually add the files.
    if (addedFiles.length === 0) {
      throw new Error(
        files.pathFromRepoRoot(path) + " did not match any files"
      );
    } else {
      addedFiles.forEach((p) => {
        version.update_index(p, { add: true });
      });
    }
  },

  // rm() removes files that match path from the index.
  rm: (path, opts) => {
    files.assertInRepo();
    config.assertNotBare();
    opts = opts || {};

    // Get the paths of all files in the index that match path.
    const filesToRm = index.matchingFiles(path);

    // Abort if -f was passed. The removal of files with changes is not supported.
    // Abort if no files matched path.
    // Abort if path is a directory and -r was not passed.
    if (opts.f) {
      throw new Error("unsupported");
    } else if (filesToRm.length === 0) {
      throw new Error(
        files.pathFromRepoRoot(path) + " did not match any files"
      );
    } else if (
      fs.existsSync(path) &&
      fs.statSync(path).isDirectory() &&
      !opts.r
    ) {
      throw new Error("not removing " + path + " recursively without -r");
    } else {
      // Get a list of all files that are to be removed and have also been changed on disk.
      // If this list is not empty then abort.
      // Otherwise, remove the files that match path. Delete them from disk and remove from the index.
      const changesToRm = util.intersection(
        diff.addedOrModifiedFiles(),
        filesToRm
      );
      if (changesToRm.length > 0) {
        throw new Error(
          "these files have changes:\n" + changesToRm.join("\n") + "\n"
        );
      } else {
        filesToRm
          .map(files.workingCopyPath)
          .filter(fs.existsSync)
          .forEach(fs.unlinkSync);
        filesToRm.forEach((p) => {
          version.update_index(p, { remove: true });
        });
      }
    }
  },

  // commit() creates a commit object that represents the current state of the index,
  // writes the commit to the objects directory and points HEAD at the commit.
  commit: (opts) => {
    files.assertInRepo();
    config.assertNotBare();

    // Write a tree set of tree objects that represent the current state of the index.
    const treeHash = version.write_tree();
    const headDesc = refs.isHeadDetached()
      ? "detached HEAD"
      : refs.headBranchName();

    // Compare the hash of the tree object at the top of the tree that was just written with the hash of the tree object
    // that the HEAD commit points at. If they are the same, abort because there is nothing new to commit.
    if (
      refs.hash("HEAD") !== undefined &&
      treeHash === objects.treeHash(objects.read(refs.hash("HEAD")))
    ) {
      throw new Error(
        "# On " + headDesc + "\nnothing to commit, working directory clean"
      );
    } else {
      // Abort if the repository is in the merge state and there are unresolved merge conflicts.
      // Otherwise, do the commit.
      const conflictedPaths = index.conflictedPaths();
      if (merge.isMergeInProgress() && conflictedPaths.length > 0) {
        throw new Error(
          conflictedPaths
            .map((p) => {
              return "U " + p;
            })
            .join("\n") + "\ncannot commit because you have unmerged files\n"
        );
      } else {
        // If the repository is in the merge state, use a pre-written merge commit message.
        // If the repository is not in the merge state, use the message passed with -m.
        const m = merge.isMergeInProgress()
          ? files.read(files.versionPath("MERGE_MSG"))
          : opts.m;
        // Write the new commit to the objects directory.
        const commitHash = objects.writeCommit(
          treeHash,
          m,
          refs.commitParentHashes()
        );
        // Point HEAD at new commit.
        version.update_ref("HEAD", commitHash);
        // If MERGE_HEAD exists, the repository was in the merge state.
        // Remove MERGE_HEAD and MERGE_MSGto exit the merge state. Report that the merge is complete.
        if (merge.isMergeInProgress()) {
          fs.unlinkSync(files.versionPath("MERGE_MSG"));
          refs.rm("MERGE_HEAD");
          return "Merge made by the three-way strategy";
          // Repository was not in the merge state, so just report that the commit is complete.
        } else {
          return "[" + headDesc + " " + commitHash + "] " + m;
        }
      }
    }
  },

  // branch() creates a new branch that points at the commit that HEAD points at.
  branch: (name, opts) => {
    files.assertInRepo();
    opts = opts || {};

    // If no branch name was passed, list the local branches.
    if (name === undefined) {
      return (
        Object.keys(refs.localHeads())
          .map((branch) => {
            return (branch === refs.headBranchName() ? "* " : "  ") + branch;
          })
          .join("\n") + "\n"
      );
      // HEAD is not pointing at a commit, so there is no commit for the new branch to point at. Abort.
      // This is most likely to happen if the repository has no commits.
    } else if (refs.hash("HEAD") === undefined) {
      throw new Error(refs.headBranchName() + " not a valid object name");

      // Abort because a branch called name already exists.
    } else if (refs.exists(refs.toLocalRef(name))) {
      throw new Error("A branch named " + name + " already exists");

      // Otherwise, create a new branch by creating a new file called name
      // that contains the hash of the commit that HEAD points at.
    } else {
      version.update_ref(refs.toLocalRef(name), refs.hash("HEAD"));
    }
  },

  // checkout() changes the index, working copy and HEAD to reflect the content of ref.
  //   ref might be a branch name or a commit hash.
  checkout: (ref, _) => {
    files.assertInRepo();
    config.assertNotBare();

    // Get the hash of the commit to check out.
    const toHash = refs.hash(ref);

    // Abort if ref cannot be found.
    if (!objects.exists(toHash)) {
      throw new Error(ref + " did not match any file(s) known to Version");

      // Abort if the hash to check out points to an object that is a not a commit.
    } else if (objects.type(objects.read(toHash)) !== "commit") {
      throw new Error("reference is not a tree: " + ref);

      // Abort if ref is the name of the branch currently checked out. Abort if head is detached, ref is a commit hash and HEAD is pointing at that hash.
    } else if (
      ref === refs.headBranchName() ||
      ref === files.read(files.versionPath("HEAD"))
    ) {
      return "Already on " + ref;
    } else {
      // Get a list of files changed in the working copy. Get a list of the files that are different in the head commit and the commit to check out.
      // If any files appear in both lists then abort.
      const paths = diff.changedFilesCommitWouldOverwrite(toHash);
      if (paths.length > 0) {
        throw new Error(
          "local changes would be lost\n" + paths.join("\n") + "\n"
        );

        // Otherwise, perform the checkout.
      } else {
        process.chdir(files.workingCopyPath());

        // If the ref is in the objects directory, it must be a hash and so this checkout is detaching the head.
        const isDetachingHead = objects.exists(ref);

        // Get the list of differences between the current commit and the commit to check out. Write them to the working copy.
        workingCopy.write(diff.diff(refs.hash("HEAD"), toHash));

        // Write the commit being checked out to HEAD. If the head is being detached, the commit hash is written directly to the HEAD file.
        // If the head is not being detached, the branch being checked out is written to HEAD.
        refs.write(
          "HEAD",
          isDetachingHead ? toHash : "ref: " + refs.toLocalRef(ref)
        );

        // Set the index to the contents of the commit being checked out.
        index.write(index.tocToIndex(objects.commitToc(toHash)));

        // Report the result of the checkout.
        return isDetachingHead
          ? "Note: checking out " + toHash + "\nYou are in detached HEAD state."
          : "Switched to branch " + ref;
      }
    }
  },

  // diff() shows the changes required to go from the ref1 commit to the ref2 commit.
  diff: (ref1, ref2, opts) => {
    files.assertInRepo();
    config.assertNotBare();

    // Abort if ref1 was supplied, but it does not resolve to a hash.
    if (ref1 !== undefined && refs.hash(ref1) === undefined) {
      throw new Error("ambiguous argument " + ref1 + ": unknown revision");

      // Abort if ref2 was supplied, but it does not resolve to a hash.
    } else if (ref2 !== undefined && refs.hash(ref2) === undefined) {
      throw new Error("ambiguous argument " + ref2 + ": unknown revision");

      // Otherwise, perform diff.
    } else {
      // Version only shows the name of each changed file and whether it was added, modified or deleted. For simplicity, the changed content is not shown.
      // The diff happens between two versions of the repository. The first version is either the hash that ref1 resolves to, or the index.
      // The second version is either the hash that ref2 resolves to, or the working copy.
      const nameToStatus = diff.nameStatus(
        diff.diff(refs.hash(ref1), refs.hash(ref2))
      );

      // Show the path of each changed file.
      return (
        Object.keys(nameToStatus)
          .map((path) => {
            return nameToStatus[path] + " " + path;
          })
          .join("\n") + "\n"
      );
    }
  },

  // remote() records the locations of remote versions of this repository.
  remote: (command, name, path, _) => {
    files.assertInRepo();

    // Abort if command is not “add”. Only “add” is supported.
    if (command !== "add") {
      throw new Error("unsupported");

      // Abort if repository already has a record for a remote called name.
    } else if (name in config.read()["remote"]) {
      throw new Error("remote " + name + " already exists");

      // Otherwise, add remote record.
    } else {
      // Write to the config file a record of the name and path of the remote.
      config.write(util.setIn(config.read(), ["remote", name, "url", path]));
      return "\n";
    }
  },

  // fetch() records the commit that branch is at on remote. It does not change the local branch.
  fetch: (remote, branch, _) => {
    files.assertInRepo();

    // Abort if a remote or branch not passed.
    if (remote === undefined || branch === undefined) {
      throw new Error("unsupported");

      // Abort if remote not recorded in config file.
    } else if (!(remote in config.read().remote)) {
      throw new Error(remote + " does not appear to be a git repository");
    } else {
      // Get the location of the remote.
      const remoteUrl = config.read().remote[remote].url;

      // Turn the unqualified branch name into a qualified remote ref eg [branch] -> refs/remotes/[remote]/[branch]
      const remoteRef = refs.toRemoteRef(remote, branch);

      // Go to the remote repository and get the hash of the commit that branch is on.
      const newHash = util.onRemote(remoteUrl)(refs.hash, branch);

      // Abort if branch did not exist on the remote.
      if (newHash === undefined) {
        throw new Error("couldn't find remote ref " + branch);

        // Otherwise, perform the fetch.
      } else {
        // Note down the hash of the commit this repository currently thinks the remote branch is on.
        const oldHash = refs.hash(remoteRef);

        // Get all the objects in the remote objects directory and write them. to the local objects directory. (This is an inefficient way of getting all the objects required to recreate locally the commit the remote branch is on.)
        const remoteObjects = util.onRemote(remoteUrl)(objects.allObjects);
        remoteObjects.forEach(objects.write);

        // Set the contents of the file at .version/refs/remotes/[remote]/[branch] to newHash, the hash of the commit that the remote branch is on.
        version.update_ref(remoteRef, newHash);

        // Record the hash of the commit that the remote branch is on in FETCH_HEAD. (The user can call version merge FETCH_HEAD to merge the remote version of the branch into their local branch. For more details, see version.merge().)
        refs.write(
          "FETCH_HEAD",
          newHash + " branch " + branch + " of " + remoteUrl
        );

        // Report the result of the fetch.
        return (
          [
            "From " + remoteUrl,
            "Count " + remoteObjects.length,
            branch +
              " -> " +
              remote +
              "/" +
              branch +
              (merge.isAForceFetch(oldHash, newHash) ? " (forced)" : ""),
          ].join("\n") + "\n"
        );
      }
    }
  },

  // merge() finds the set of differences between the commit that the currently checked out branch is on and the commit that ref points to.
  // It finds or creates a commit that applies these differences to the checked out branch.
  merge: (ref, _) => {
    files.assertInRepo();
    config.assertNotBare();

    // Get the receiverHash, the hash of the commit that the current branch is on.
    const receiverHash = refs.hash("HEAD");

    // Get the giverHash, the hash for the commit to merge into the receiver commit.
    const giverHash = refs.hash(ref);

    // Abort if head is detached. Merging into a detached head is not supported.
    if (refs.isHeadDetached()) {
      throw new Error("unsupported");

      // Abort if ref did not resolve to a hash, or if that hash is not for a commit object.
    } else if (
      giverHash === undefined ||
      objects.type(objects.read(giverHash)) !== "commit"
    ) {
      throw new Error(ref + ": expected commit type");

      // Do not merge if the current branch - the receiver - already has the giver’s changes. This is the case if the receiver and giver are the same commit, or if the giver is an ancestor of the receiver.
    } else if (objects.isUpToDate(receiverHash, giverHash)) {
      return "Already up-to-date";
    } else {
      // Get a list of files changed in the working copy. Get a list of the files that are different in the receiver and giver. If any files appear in both lists then abort.
      const paths = diff.changedFilesCommitWouldOverwrite(giverHash);
      if (paths.length > 0) {
        throw new Error(
          "local changes would be lost\n" + paths.join("\n") + "\n"
        );

        // If the receiver is an ancestor of the giver, a fast forward is performed. This is possible because there is already a commit that incorporates all of the giver’s changes into the receiver.
      } else if (merge.canFastForward(receiverHash, giverHash)) {
        // Fast forwarding means making the current branch reflect the commit that giverHash points at. The branch is pointed at giverHash. The index is set to match the contents of the commit that giverHash points at. The working copy is set to match the contents of that commit.
        merge.writeFastForwardMerge(receiverHash, giverHash);
        return "Fast-forward";

        // If the receiver is not an ancestor of the giver, a merge commit must be created.
      } else {
        // The repository is put into the merge state. The MERGE_HEAD file is written and its contents set to giverHash. The MERGE_MSG file is written and its contents set to a boilerplate merge commit message. A merge diff is created that will turn the contents of receiver into the contents of giver. This contains the path of every file that is different and whether it was added, removed or modified, or is in conflict. Added files are added to the index and working copy. Removed files are removed from the index and working copy. Modified files are modified in the index and working copy. Files that are in conflict are written to the working copy to include the receiver and giver versions. Both the receiver and giver versions are written to the index.
        merge.writeNonFastForwardMerge(receiverHash, giverHash, ref);

        // If there are any conflicted files, a message is shown to say that the user must sort them out before the merge can be completed.
        if (merge.hasConflicts(receiverHash, giverHash)) {
          return "Automatic merge failed. Fix conflicts and commit the result.";

          // If there are no conflicted files, a commit is created from the merged changes and the merge is over.
        } else {
          return version.commit();
        }
      }
    }
  },

  // pull() fetches the commit that branch is on at remote. It merges that commit into the current branch.
  pull: (remote, branch, _) => {
    files.assertInRepo();
    config.assertNotBare();
    version.fetch(remote, branch);
    return version.merge("FETCH_HEAD");
  },

  // push() gets the commit that branch is on in the local repo and points branch on remote at the same commit.
  push: (remote, branch, opts) => {
    files.assertInRepo();
    opts = opts || {};

    // Abort if a remote or branch not passed.
    if (remote === undefined || branch === undefined) {
      throw new Error("unsupported");

      // Abort if remote not recorded in config file.
    } else if (!(remote in config.read().remote)) {
      throw new Error(remote + " does not appear to be a git repository");
    } else {
      const remotePath = config.read().remote[remote].url;
      const remoteCall = util.onRemote(remotePath);

      // Abort if remote repository is not bare and branch is checked out.
      if (remoteCall(refs.isCheckedOut, branch)) {
        throw new Error("refusing to update checked out branch " + branch);
      } else {
        // Get receiverHash, the hash of the commit that branch is on at remote.
        const receiverHash = remoteCall(refs.hash, branch);

        // Get giverHash, the hash of the commit that branch is on at the local repository.
        const giverHash = refs.hash(branch);

        // Do nothing if the remote branch - the receiver - has already incorporated the commit that giverHash points to. This is the case if the receiver commit and giver commit are the same, or if the giver commit is an ancestor of the receiver commit.
        if (objects.isUpToDate(receiverHash, giverHash)) {
          return "Already up-to-date";

          // Abort if branch on remote cannot be fast forwarded to the commit that giverHash points to. A fast forward can only be done if the receiver commit is an ancestor of the giver commit.
        } else if (!opts.f && !merge.canFastForward(receiverHash, giverHash)) {
          throw new Error("failed to push some refs to " + remotePath);

          // Otherwise, do the push.
        } else {
          // Put all the objects in the local objects directory into the remote objects directory.
          objects.allObjects().forEach(function (o) {
            remoteCall(objects.write, o);
          });

          // Point branch on remote at giverHash.
          remoteCall(version.update_ref, refs.toLocalRef(branch), giverHash);

          // Set the local repo’s record of what commit branch is on at remote to giverHash (since that is what it is now is).
          version.update_ref(refs.toRemoteRef(remote, branch), giverHash);

          // Report the result of the push.
          return (
            [
              "To " + remotePath,
              "Count " + objects.allObjects().length,
              branch + " -> " + branch,
            ].join("\n") + "\n"
          );
        }
      }
    }
  },

  // status() reports the state of the repo: the current branch, untracked files, conflicted files,
  // files that are staged to be committed and files that are not staged to be committed.
  status: (_) => {
    files.assertInRepo();
    config.assertNotBare();
    return status.toString();
  },

  // clone() copies the repository at remotePath to **targetPath.
  clone: (remotePath, targetPath, opts) => {
    opts = opts || {};

    // Abort if a remotePath or targetPath not passed.
    if (remotePath === undefined || targetPath === undefined) {
      throw new Error("you must specify remote path and target path");

      // Abort if remotePath does not exist, or is not a version repository.
    } else if (
      !fs.existsSync(remotePath) ||
      !util.onRemote(remotePath)(files.inRepo)
    ) {
      throw new Error("repository " + remotePath + " does not exist");

      // Abort if targetPath exists and is not empty.
    } else if (
      fs.existsSync(targetPath) &&
      fs.readdirSync(targetPath).length > 0
    ) {
      throw new Error(targetPath + " already exists and is not empty");

      // Otherwise, do the clone.
    } else {
      remotePath = nodePath.resolve(process.cwd(), remotePath);

      // If targetPath doesn’t exist, create it.
      if (!fs.existsSync(targetPath)) {
        fs.mkdirSync(targetPath);
      }

      // In the directory for the new remote repository…
      util.onRemote(targetPath)(function () {
        // Initialize the directory as a version repository.
        version.init(opts);

        // Set up remotePath as a remote called “origin”.
        version.remote(
          "add",
          "origin",
          nodePath.relative(process.cwd(), remotePath)
        );

        // Get the hash of the commit that master is pointing at on the remote repository.
        const remoteHeadHash = util.onRemote(remotePath)(refs.hash, "master");

        // If the remote repo has any commits, that hash will exist. The new repository records the commit that the passed branch is at on the remote.
        // It then sets master on the new repository to point at that commit.
        if (remoteHeadHash !== undefined) {
          version.fetch("origin", "master");
          merge.writeFastForwardMerge(undefined, remoteHeadHash);
        }
      });

      // Report the result of the clone.
      return "Cloning into " + targetPath;
    }
  },

  // update_index() adds the contents of the file at path to the index, or removes the file from the index.
  update_index: (path, opts) => {
    files.assertInRepo();
    config.assertNotBare();
    opts = opts || {};
    const pathFromRoot = files.pathFromRepoRoot(path);
    const isOnDisk = fs.existsSync(path);
    const isInIndex = index.hasFile(path, 0);

    // Abort if path is a directory. update_index() only handles single files.
    if (isOnDisk && fs.statSync(path).isDirectory()) {
      throw new Error(pathFromRoot + " is a directory - add files inside\n");
    } else if (opts.remove && !isOnDisk && isInIndex) {
      // Abort if file is being removed and is in conflict. version doesn’t support this.
      if (index.isFileInConflict(path)) {
        throw new Error("unsupported");

        // If files is being removed, is not on disk and is in the index, remove it from the index.
      } else {
        index.writeRm(path);
        return "\n";
      }

      // If file is being removed, is not on disk and not in the index, there is no work to do.
    } else if (opts.remove && !isOnDisk && !isInIndex) {
      return "\n";

      // Abort if the file is on disk and not in the index and the --add was not passed.
    } else if (!opts.add && isOnDisk && !isInIndex) {
      throw new Error(
        "cannot add " + pathFromRoot + " to index - use --add option\n"
      );

      // If file is on disk and either -add was passed or the file is in the index, add the file’s current content to the index.
    } else if (isOnDisk && (opts.add || isInIndex)) {
      index.writeNonConflict(path, files.read(files.workingCopyPath(path)));
      return "\n";

      // Abort if the file is not on disk and --remove not passed.
    } else if (!opts.remove && !isOnDisk) {
      throw new Error(
        pathFromRoot + " does not exist and --remove not passed\n"
      );
    }
  },

  // write_tree() takes the content of the index and stores a tree object that represents that content to the objects directory.
  write_tree: function (_) {
    files.assertInRepo();
    return objects.writeTree(files.nestFlatTree(index.toc()));
  },

  // update_ref() gets the hash of the commit that refToUpdateTo points at and sets refToUpdate to point at the same hash.
  update_ref: function (refToUpdate, refToUpdateTo, _) {
    files.assertInRepo();

    // Get the hash that refToUpdateTo points at.
    const hash = refs.hash(refToUpdateTo);

    // Abort if refToUpdateTo does not point at a hash.

    if (!objects.exists(hash)) {
      throw new Error(refToUpdateTo + " not a valid SHA1");

      // Abort if refToUpdate does not match the syntax of a ref.
    } else if (!refs.isRef(refToUpdate)) {
      throw new Error("cannot lock the ref " + refToUpdate);

      // Abort if hash points to an object in the objects directory that is not a commit.
    } else if (objects.type(objects.read(hash)) !== "commit") {
      const branch = refs.terminalRef(refToUpdate);
      throw new Error(
        branch + " cannot refer to non-commit object " + hash + "\n"
      );

      // Otherwise, set the contents of the file that the ref represents to hash.
    } else {
      refs.write(refs.terminalRef(refToUpdate), hash);
    }
  },
};
