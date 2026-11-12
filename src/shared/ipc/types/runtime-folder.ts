// What the Linux channel checks about its runtime folder before it trusts it (S5).

/** The facts of `lstat`, so a symbolic link is never followed. */
export interface FolderFacts {
  isDirectory: boolean;
  uid: number;
  mode: number;
}
