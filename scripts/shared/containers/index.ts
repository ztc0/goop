// Container tooling shared by the scripts: which engine to use, the arguments Podman and
// Docker take in the same form, and the host process runner and terminal they run through.
export { installedEngines, terminalOutput } from "@scripts/shared/containers/adapters/host";
export { bunProcessRunner } from "@scripts/shared/containers/adapters/process-runner";
export {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  execArgs,
  imageSizeArgs,
  listRunningArgs,
  logsArgs,
  removeArgs,
} from "@scripts/shared/containers/model/container-args";
export {
  chooseEngine,
  DOCKER_WARNING,
  type EngineChoice,
} from "@scripts/shared/containers/model/engine-choice";
export {
  dockerEnvironment,
  podmanEnvironment,
  podmanGlobalArgs,
} from "@scripts/shared/containers/model/engine-env";
export type {
  EngineName,
  ExecOptions,
  Output,
  PodmanStorage,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "@scripts/shared/containers/types/containers";
