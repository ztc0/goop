// Native libraries (S4-S6): the build's pinned sha256 is checked before every load, on the built
// copy while developing and on the copy goop extracts to `<GOOP_HOME>/lib/native/` in the
// distributed executable.

export {
  type BuiltNativeLibraryOptions,
  builtNativeLibrary,
} from "@/shared/vault/native/adapters/built-native-library";
export {
  type NativeLibraryFolderOptions,
  nativeLibraryFolder,
} from "@/shared/vault/native/adapters/native-library-folder";
export {
  NativeLibraryError,
  NativeManifestError,
  nativePlatform,
  parseNativeManifest,
  pinnedLibrary,
} from "@/shared/vault/native/model/native-library";
export type {
  NativeFiles,
  NativeManifest,
  NativePlatform,
  PinnedFile,
  PinnedLibrary,
  VerifiedLibraryPath,
} from "@/shared/vault/native/types/native-library";
