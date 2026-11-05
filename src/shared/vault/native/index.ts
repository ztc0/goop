// Native libraries (S8): the build's pinned sha256 is checked on a cached copy before every load.

export {
  type NativeLibraryCacheOptions,
  nativeLibraryCache,
} from "./adapters/native-library-cache";
export {
  NativeLibraryError,
  NativeManifestError,
  nativePlatform,
  parseNativeManifest,
  pinnedLibrary,
} from "./model/native-library";
export type {
  NativeFiles,
  NativeManifest,
  NativePlatform,
  PinnedFile,
  PinnedLibrary,
} from "./types/native-library";
