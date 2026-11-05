import { describe, expect, test } from "bun:test";
import { credsArgs, parseSystemdVersion, systemdAvailability } from "../../model/systemd-creds";

const TPM2_YES = "yes\n+firmware\n+driver\n+system\n+subsystem\n+libraries\n";
const TPM2_NO = "no\n-firmware\n-driver\n-system\n-subsystem\n+libraries\n";

describe("systemd-creds argv", () => {
  test("encrypt is user scoped, host+tpm2, bound to goop-dek, from stdin to stdout", () => {
    expect(credsArgs("encrypt")).toEqual([
      "--user",
      "encrypt",
      "--with-key=host+tpm2",
      "--name=goop-dek",
      "-",
      "-",
    ]);
  });

  test("neither carries an option systemd 256 or 257 does not know", () => {
    // systemd 257 (Debian 13 sandbox): "unrecognized option '--no-ask-password'".
    expect([...credsArgs("encrypt"), ...credsArgs("decrypt")]).not.toContain("--no-ask-password");
  });

  test("decrypt is user scoped, bound to goop-dek, from stdin to stdout", () => {
    expect(credsArgs("decrypt")).toEqual(["--user", "decrypt", "--name=goop-dek", "-", "-"]);
  });
});

describe("systemd version", () => {
  test.each([
    ["systemd 262 (262.1-1-arch)\n+PAM +AUDIT -SELINUX\n", 262],
    ["systemd 257 (257.9-1~deb13u1)\n", 257],
    ["systemd 256 (256.5)", 256],
    ["systemd 255 (255.4-1ubuntu8)\n", 255],
    ["  systemd 256~rc1 (256~rc1)\n", 256],
  ])("%j is version %d", (output, version) => {
    expect(parseSystemdVersion(output)).toBe(version);
  });

  test.each(["", "systemd", "systemd (262)", "elogind 255", "Unknown command verb '--version'."])(
    "%j has no version",
    (output) => {
      expect(parseSystemdVersion(output)).toBeUndefined();
    },
  );
});

describe("availability", () => {
  test("systemd 256 or 257 with a TPM2 that reports yes is available", () => {
    expect(systemdAvailability("systemd 256 (256.5)\n", TPM2_YES, 0)).toEqual({
      available: true,
    });
    expect(systemdAvailability("systemd 257 (257.9)\n", TPM2_YES, 0)).toEqual({
      available: true,
    });
  });

  test("systemd 255 is too old, whatever the TPM2 says", () => {
    expect(systemdAvailability("systemd 255 (255.4-1ubuntu8)\n", TPM2_YES, 0)).toEqual({
      available: false,
      reason: "old-version",
      message: "systemd 255 is too old: the OS key store needs systemd 256 or later.",
    });
  });

  test("an unreadable version is unavailable, never guessed", () => {
    expect(systemdAvailability("odd output", TPM2_YES, 0)).toEqual({
      available: false,
      reason: "old-version",
      message:
        "The systemd version could not be read: the OS key store needs systemd 256 or later.",
    });
  });

  test.each([
    ["no TPM2", TPM2_NO, 1],
    ["a partial TPM2", "partial\n+firmware\n-driver\n", 1],
    ["yes with a failed exit", TPM2_YES, 1],
    ["an exit 0 without yes", "maybe\n", 0],
  ])("%s is unavailable", (_, output, exitCode) => {
    expect(systemdAvailability("systemd 262 (262.1)\n", output, exitCode)).toEqual({
      available: false,
      reason: "no-tpm2",
      message: 'No usable TPM2: "systemd-creds has-tpm2" did not report yes.',
    });
  });
});
