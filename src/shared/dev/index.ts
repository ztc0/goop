// Dev: the repo-local development layout, so the machine stays clean (S25, S26).

export { ensurePrivateFolder } from "@/shared/dev/adapters/private-folder";
export {
  type DevLayout,
  devEnvironment,
  devLayout,
  type LocalLayout,
  layoutDirectories,
  privateDirectories,
  type TempLayout,
} from "@/shared/dev/model/dev-layout";
