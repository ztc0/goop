// Container tooling shared by the scripts: which engine to use, the arguments Podman and
// Docker take in the same form, and the host process runner and terminal they run through.
export { installedEngines, terminalOutput } from "./adapters/host";
export { bunProcessRunner } from "./adapters/process-runner";
export {
  buildArgs,
  copyInArgs,
  copyOutArgs,
  execArgs,
  imageSizeArgs,
  listRunningArgs,
  logsArgs,
  removeArgs,
} from "./model/container-args";
export { chooseEngine, DOCKER_WARNING, type EngineChoice } from "./model/engine-choice";
export { dockerEnvironment, podmanEnvironment, podmanGlobalArgs } from "./model/engine-env";
export type {
  EngineName,
  ExecOptions,
  Output,
  PodmanStorage,
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "./types/containers";
