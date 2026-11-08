import { describe, expect, test } from "bun:test";
import { checkToolchain, listedSha256 } from "@scripts/native-libs/model/checks";
import { COSIGN, cosignArgs } from "@scripts/native-libs/model/signature";

const TOOLCHAIN = [
  { name: "gcc-14", version: "14.2.0-19" },
  { name: "libc6-dev", version: "2.41-12+deb13u4" },
];

describe("checkToolchain", () => {
  test("passes when dpkg-query lists every pinned version", () => {
    expect(checkToolchain(TOOLCHAIN, "gcc-14 14.2.0-19\nlibc6-dev 2.41-12+deb13u4\n")).toEqual([]);
  });

  test("names each package that is missing or has another version", () => {
    expect(checkToolchain(TOOLCHAIN, "gcc-14 14.2.0-20\n\n")).toEqual([
      "gcc-14 is 14.2.0-20, expected 14.2.0-19",
      "libc6-dev is not installed, expected 2.41-12+deb13u4",
    ]);
  });
});

describe("listedSha256", () => {
  const SUMS = [
    `${"a".repeat(64)}  sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip`,
    `${"b".repeat(64)} *sqlite3mc-2.6.1-sqlite-3.54.0-win64.zip`,
    "",
  ].join("\n");

  test("finds the sha256 a checksum list gives a file, in text or binary mode", () => {
    expect(listedSha256(SUMS, "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation.zip")).toBe(
      "a".repeat(64),
    );
    expect(listedSha256(SUMS, "sqlite3mc-2.6.1-sqlite-3.54.0-win64.zip")).toBe("b".repeat(64));
  });

  test("is undefined for a file it does not list, even as a prefix or suffix", () => {
    expect(listedSha256(SUMS, "sqlite3mc-2.6.1-sqlite-3.54.0-amalgamation")).toBeUndefined();
    expect(listedSha256(SUMS, "amalgamation.zip")).toBeUndefined();
  });
});

describe("Cosign", () => {
  test("the cosign binary is pinned by version, https URL and sha256", () => {
    expect(COSIGN).toEqual({
      name: "cosign-linux-amd64",
      version: "v2.6.5",
      url: "https://github.com/sigstore/cosign/releases/download/v2.6.5/cosign-linux-amd64",
      sha256: "c3b4f5410e608af03a5eb0aaac84a4313d8da131248e08ff1759ac70c79d1644",
      maxBytes: 160 * 1024 * 1024,
    });
  });

  test("verify-blob takes the certificate, the signature and the exact identity and issuer", () => {
    expect(
      cosignArgs(
        { identity: "https://example.test/wf.yml@refs/heads/main", issuer: "https://issuer.test" },
        { list: "/d/SUMS", signature: "/d/SUMS.sig", certificate: "/d/SUMS.pem" },
      ),
    ).toEqual([
      "verify-blob",
      "--certificate",
      "/d/SUMS.pem",
      "--signature",
      "/d/SUMS.sig",
      "--certificate-identity",
      "https://example.test/wf.yml@refs/heads/main",
      "--certificate-oidc-issuer",
      "https://issuer.test",
      "/d/SUMS",
    ]);
  });
});
