// Refs are names for commit hashes. The ref is the name of a file.
// Some refs represent local branches, like refs/heads/master or refs/heads/feature.
// Some represent remote branches, like refs/remotes/origin/master.
// Some represent important states of the repository, like HEAD, MERGE_HEAD and FETCH_HEAD.
// Ref files contain either a hash or another ref.
export const refs = {
  // isRef() returns true if ref matches valid qualified ref syntax.
  isRef: (ref) => {
    return (
      ref !== undefined &&
      (ref.match("^refs/heads/[A-Za-z-]+$") ||
        ref.match("^refs/remotes/[A-Za-z-]+/[A-Za-z-]+$") ||
        ["HEAD", "FETCH_HEAD", "MERGE_HEAD"].indexOf(ref) !== -1)
    );
  },

  // terminalRef() resolves ref to the most specific ref possible.
  terminalRef: (ref) => {
    // If ref is “HEAD” and head is pointing at a branch, return the branch.
    if (ref === "HEAD" && !refs.isHeadDetached()) {
      return files
        .read(files.versionPath("HEAD"))
        .match("ref: (refs/heads/.+)")[1];
      // If ref is qualified, return it.
    } else if (refs.isRef(ref)) {
      return ref;
      // Otherwise, assume ref is an unqualified local ref (like master) and turn it into a qualified ref (like refs/heads/master)
    } else {
      return refs.toLocalRef(ref);
    }
  },

  // hash() returns the hash that refOrHash points to.
  hash: (refOrHash) => {
    if (objects.exists(refOrHash)) {
      return refOrHash;
    } else {
      const terminalRef = refs.terminalRef(refOrHash);
      if (terminalRef === "FETCH_HEAD") {
        return refs.fetchHeadBranchToMerge(refs.headBranchName());
      } else if (refs.exists(terminalRef)) {
        return files.read(files.versionPath(terminalRef));
      }
    }
  },

  // isHeadDetached() returns true if HEAD contains a commit hash, rather than the ref of a branch.
  isHeadDetached: () => {
    return files.read(files.versionPath("HEAD")).match("refs") === null;
  },

  // isCheckedOut() returns true if the repository is not bare and HEAD is pointing at the branch called branch
  isCheckedOut: (branch) => {
    return !config.isBare() && refs.headBranchName() === branch;
  },

  // toLocalRef() converts the branch name name into a qualified local branch ref.
  toLocalRef: (name) => {
    return "refs/heads/" + name;
  },

  // toRemoteRef() converts remote and branch name name into a qualified remote branch ref.
  toRemoteRef: (remote, name) => {
    return "refs/remotes/" + remote + "/" + name;
  },

  // write() sets the content of the file for the qualified ref ref to content.
  write: (ref, content) => {
    if (refs.isRef(ref)) {
      files.write(files.versionPath(nodePath.normalize(ref)), content);
    }
  },

  // rm() removes the file for the qualified ref ref.
  rm: (ref) => {
    if (refs.isRef(ref)) {
      fs.unlinkSync(files.versionPath(ref));
    }
  },

  // fetchHeadBranchToMerge() reads the FETCH_HEAD file and gets the hash that the remote branchName is pointing at.
  // For more information about FETCH_HEAD see version.fetch().
  fetchHeadBranchToMerge: (branchName) => {
    return util
      .lines(files.read(files.versionPath("FETCH_HEAD")))
      .filter((l) => {
        return l.match("^.+ branch " + branchName + " of");
      })
      .map((l) => {
        return l.match("^([^ ]+) ")[1];
      })[0];
  },

  // localHeads() returns a JS object that maps local branch names to the hash of the commit they point to.
  localHeads: () => {
    return fs
      .readdirSync(nodePath.join(files.versionPath(), "refs", "heads"))
      .reduce((o, n) => {
        return util.setIn(o, [n, refs.hash(n)]);
      }, {});
  },

  // exists() returns true if the qualified ref ref exists.
  exists: (ref) => {
    return refs.isRef(ref) && fs.existsSync(files.versionPath(ref));
  },

  // headBranchName() returns the name of the branch that HEAD is pointing at.
  headBranchName: () => {
    if (!refs.isHeadDetached()) {
      return files.read(files.versionPath("HEAD")).match("refs/heads/(.+)")[1];
    }
  },

  // commitParentHashes() returns the array of commits that would be the parents of the next commit.
  commitParentHashes: () => {
    const headHash = refs.hash("HEAD");

    //   If the repository is in the middle of a merge, return the hashes of the two commits being merged.

    if (merge.isMergeInProgress()) {
      return [headHash, refs.hash("MERGE_HEAD")];

      //   If this repository has no commits, return an empty array.
    } else if (headHash === undefined) {
      return [];

      //   Otherwise, return the hash of the commit that HEAD is currently pointing at.
    } else {
      return [headHash];
    }
  },
};
