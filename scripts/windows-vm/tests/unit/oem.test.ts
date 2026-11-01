import { describe, expect, test } from "bun:test";
import { oemFiles, parsePublicKey } from "../../model/oem";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTests";

describe("parsePublicKey", () => {
  test("keeps the type and the key, and drops the comment", () => {
    expect(parsePublicKey(`${KEY} goop-windows-vm\n`)).toBe(KEY);
    expect(parsePublicKey(KEY)).toBe(KEY);
  });

  test("rejects anything that is not one ed25519 public key", () => {
    expect(parsePublicKey("ssh-rsa AAAAB3NzaC1yc2E")).toBeUndefined();
    expect(parsePublicKey("ssh-ed25519 AAAA'; Remove-Item C:\\ -Recurse; '")).toBeUndefined();
    expect(parsePublicKey(`${KEY}\n${KEY}`)).toBeUndefined();
    expect(parsePublicKey("")).toBeUndefined();
  });
});

describe("oemFiles", () => {
  const files = oemFiles(KEY);

  test("install.bat runs setup.ps1 with PowerShell", () => {
    expect(files.installBat).toBe(
      "@echo off\r\npowershell -ExecutionPolicy Bypass -File C:\\OEM\\setup.ps1 > C:\\OEM\\setup.log 2>&1\r\n",
    );
  });

  test("setup.ps1 sets up OpenSSH in order and writes the ready marker last", () => {
    const steps = [
      "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0",
      "Set-Service -Name sshd -StartupType Automatic",
      "Start-Service -Name sshd",
      "New-NetFirewallRule -Name goop-sshd",
      "-LocalPort 22",
      "New-ItemProperty -Path 'HKLM:\\SOFTWARE\\OpenSSH' -Name DefaultShell",
      "$keyFile = 'C:\\ProgramData\\ssh\\administrators_authorized_keys'",
      `Set-Content -Path $keyFile -Value '${KEY}' -Encoding ascii`,
      "icacls $keyFile /inheritance:r /grant Administrators:F /grant SYSTEM:F",
      // A stricter policy at another scope makes this throw; that must not stop the setup.
      "try { Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force } catch [System.Security.SecurityException] { }",
      "Set-Content -Path 'C:\\OEM\\ready.txt' -Value 'ready' -Encoding ascii",
    ];
    let previous = -1;
    for (const step of steps) {
      const index = files.setupPs1.indexOf(step);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    const lines = files.setupPs1.trimEnd().split("\r\n");
    expect(lines.at(-1)).toBe(
      "Set-Content -Path 'C:\\OEM\\ready.txt' -Value 'ready' -Encoding ascii",
    );
  });

  test("uses Windows line endings", () => {
    expect(files.setupPs1.replaceAll("\r\n", "")).not.toContain("\n");
    expect(files.installBat.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("refuses a key that is not a validated ed25519 key", () => {
    expect(() => oemFiles("ssh-ed25519 AAAA' + (Remove-Item C:\\) + '")).toThrow(
      "Not an ed25519 public key",
    );
  });
});
