import { join } from "node:path";
import { oemFiles, parsePublicKey } from "@scripts/sandbox/model/oem";
import { displayPath } from "@scripts/sandbox/model/paths";
import { formatElapsed, INSTALL_READINESS } from "@scripts/sandbox/model/readiness";
import { INSTALL_CONTAINER, WEB_URL } from "@scripts/sandbox/model/vm-config";
import {
  guestPassword,
  prepareContainerStorage,
  reportNotReady,
  waitUntilReady,
} from "@scripts/sandbox/services/vm-lifecycle";
import type { SandboxDeps } from "@scripts/sandbox/types/sandbox";

/**
 * Installs Windows once into .local/windows/base/ (S5): the container installs Windows,
 * the OEM script enables SSH, and the container is stopped and removed when the
 * C:\OEM\ready.txt marker exists. The base stays.
 */
export async function installWindows(deps: SandboxDeps): Promise<number> {
  const { paths, files, output, engine, guest } = deps;
  if (files.exists(paths.baseDisk)) {
    output.error(
      `A Windows base already exists in ${displayPath(paths, paths.base)}. Delete that folder to install again.`,
    );
    return 1;
  }
  for (const directory of [paths.base, paths.oem, paths.ssh, paths.temp]) {
    files.makeDirectory(directory);
  }
  prepareContainerStorage(deps);

  if (!files.exists(paths.sshKey)) {
    output.info("Generating the SSH key for the VM...");
    const generated = await guest.generateKey();
    if (generated.exitCode !== 0) {
      output.error(`Could not generate the SSH key: ${generated.stderr.trim()}`);
      return 1;
    }
  }
  const publicKey = parsePublicKey(files.readText(paths.sshPublicKey));
  if (publicKey === undefined) {
    output.error(`Not an ed25519 public key: ${displayPath(paths, paths.ssh)}id_ed25519.pub`);
    return 1;
  }
  const oem = oemFiles(publicKey);
  files.writeFile(join(paths.oem, "install.bat"), oem.installBat);
  files.writeFile(join(paths.oem, "setup.ps1"), oem.setupPs1);
  const password = guestPassword(deps, true);

  output.info(`Starting ${INSTALL_CONTAINER} (the first install takes about 25 minutes)...`);
  let exitCode: number;
  try {
    const started = await engine.startInstall(password);
    if (started.exitCode !== 0) {
      output.error(`Could not start ${INSTALL_CONTAINER}: ${started.stderr.trim()}`);
      return 1;
    }
    output.info(`Watch the installation at ${WEB_URL}`);
    output.info(
      `Waiting for SSH and C:\\OEM\\ready.txt (up to ${formatElapsed(INSTALL_READINESS.timeoutMs)})...`,
    );
    const readiness = await waitUntilReady(
      deps,
      INSTALL_READINESS,
      async () => (await guest.isReachable()) && (await guest.isSetupDone()),
      (elapsed) => output.info(`Still installing (${formatElapsed(elapsed)} elapsed)...`),
    );
    if (readiness === "ready") {
      output.info("Windows is ready.");
      exitCode = 0;
    } else {
      exitCode = await reportNotReady(deps, readiness, INSTALL_READINESS, INSTALL_CONTAINER);
    }
  } finally {
    output.info(`Stopping ${INSTALL_CONTAINER}...`);
    await engine.stop(INSTALL_CONTAINER);
    await engine.remove(INSTALL_CONTAINER);
  }
  if (exitCode === 0) {
    output.info(`Windows base installed in ${displayPath(paths, paths.base)}`);
  } else {
    output.error(
      `The install did not finish. Delete ${displayPath(paths, paths.base)} before installing again.`,
    );
  }
  return exitCode;
}
