// Daemon: `goop daemon`, the service that owns the models, the queue and the database (S1, S3).

export { answer } from "@/interfaces/daemon/model/answer";
export {
  type DaemonOutput,
  LISTENING,
  serveDaemon,
} from "@/interfaces/daemon/services/serve-daemon";
