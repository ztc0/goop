// T13 spike: the pinned GGUF files. Each entry is fixed to a Hugging Face commit and the
// file's sha256 (its LFS oid), read from https://huggingface.co/api/models/<repo>/tree/<commit>.
import { join } from "node:path";

export interface ModelFile {
  id: string;
  repo: string;
  commit: string;
  file: string;
  bytes: number;
  sha256: string;
}

export const MODELS: readonly ModelFile[] = [
  {
    // Qwen 3.5 9B with its MTP layers (the plain unsloth GGUF drops them).
    id: "qwen3.5-9b-mtp-q4_k_m",
    repo: "unsloth/Qwen3.5-9B-MTP-GGUF",
    commit: "9716a636ee4bddc3fed678220b7a33dd2a4160ae",
    file: "Qwen3.5-9B-Q4_K_M.gguf",
    bytes: 5868826976,
    sha256: "e8dd94817e95d6c0939102049d068418269978377b13616c4726235e232841fe",
  },
  {
    id: "gpt-oss-20b-mxfp4",
    repo: "ggml-org/gpt-oss-20b-GGUF",
    commit: "15dcfc7e7c608c6161507211ed43c5b590801b4b",
    file: "gpt-oss-20b-MXFP4.gguf",
    bytes: 12109566624,
    sha256: "27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901",
  },
  {
    // EAGLE3 draft for gpt-oss-20b, published next to the model.
    id: "gpt-oss-20b-eagle3-q8_0",
    repo: "ggml-org/gpt-oss-20b-GGUF",
    commit: "15dcfc7e7c608c6161507211ed43c5b590801b4b",
    file: "eagle3-gpt-oss-20b-Q8_0.gguf",
    bytes: 921488000,
    sha256: "6955f98a701e97a8c969f3ff33be8ba17b35bd60e5ac96258d2c42d710c7d63f",
  },
];

/** Where download.ts stores a model: GOOP_HOME/models/<id>/<file>. */
export function modelPath(root: string, model: ModelFile): string {
  return join(root, "models", model.id, model.file);
}

export function downloadUrl(model: ModelFile): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.commit}/${model.file}`;
}
