import { describe, expect, test } from "bun:test";
import {
  ChannelError,
  MAX_SOCKET_PATH_BYTES,
  runtimeFolder,
  runtimeFolderProblem,
  socketPath,
} from "@/shared/ipc";

describe("runtimeFolder (S5)", () => {
  test("is GOOP_RUNTIME_DIR when it is set", () => {
    const env = { GOOP_RUNTIME_DIR: "/repo/.temp/run", XDG_RUNTIME_DIR: "/run/user/1000" };
    expect(runtimeFolder(env)).toBe("/repo/.temp/run");
  });

  test("is goop/ inside XDG_RUNTIME_DIR otherwise", () => {
    expect(runtimeFolder({ XDG_RUNTIME_DIR: "/run/user/1000" })).toBe("/run/user/1000/goop");
    expect(runtimeFolder({ GOOP_RUNTIME_DIR: "", XDG_RUNTIME_DIR: "/run/user/1000" })).toBe(
      "/run/user/1000/goop",
    );
  });

  test("refuses when neither is set", () => {
    for (const env of [{}, { GOOP_RUNTIME_DIR: "", XDG_RUNTIME_DIR: "" }]) {
      expect(() => runtimeFolder(env)).toThrow(
        new ChannelError("No runtime folder: set GOOP_RUNTIME_DIR or XDG_RUNTIME_DIR"),
      );
    }
  });

  test("refuses a relative path", () => {
    expect(() => runtimeFolder({ GOOP_RUNTIME_DIR: "run" })).toThrow(
      new ChannelError("GOOP_RUNTIME_DIR must be an absolute path: run"),
    );
    expect(() => runtimeFolder({ XDG_RUNTIME_DIR: "user/1000" })).toThrow(
      new ChannelError("XDG_RUNTIME_DIR must be an absolute path: user/1000"),
    );
  });
});

describe("socketPath (S5)", () => {
  test("is goop.sock inside the runtime folder", () => {
    expect(socketPath("/run/user/1000/goop")).toBe("/run/user/1000/goop/goop.sock");
  });

  test(`allows ${MAX_SOCKET_PATH_BYTES} bytes and refuses more, counting UTF-8 bytes`, () => {
    expect(MAX_SOCKET_PATH_BYTES).toBe(107);
    const room = MAX_SOCKET_PATH_BYTES - "/".length - "/goop.sock".length;
    expect(socketPath(`/${"a".repeat(room)}`)).toHaveLength(MAX_SOCKET_PATH_BYTES);

    const long = `/${"a".repeat(room + 1)}`;
    expect(() => socketPath(long)).toThrow(
      new ChannelError(`The socket path is 108 bytes, over the limit of 107: ${long}/goop.sock`),
    );
    // "ñ" is one character but two bytes.
    const wide = `/${"ñ".repeat(room / 2)}a`;
    expect(() => socketPath(wide)).toThrow(
      new ChannelError(`The socket path is 108 bytes, over the limit of 107: ${wide}/goop.sock`),
    );
  });
});

describe("runtimeFolderProblem (S5)", () => {
  const folder = "/run/user/1000/goop";
  const mine = { isDirectory: true, uid: 1000, mode: 0o40700 };

  test("accepts a folder of this user that nobody else can open", () => {
    expect(runtimeFolderProblem(folder, mine, 1000)).toBeUndefined();
  });

  test("refuses something that is not a folder, such as a symbolic link", () => {
    expect(runtimeFolderProblem(folder, { ...mine, isDirectory: false }, 1000)).toBe(
      "The runtime folder is not a folder: /run/user/1000/goop",
    );
  });

  test("refuses a folder of another user", () => {
    expect(runtimeFolderProblem(folder, { ...mine, uid: 0 }, 1000)).toBe(
      "The runtime folder belongs to another user: /run/user/1000/goop",
    );
  });

  test.each([
    [0o40750, "0750"],
    [0o40705, "0705"],
    [0o40755, "0755"],
    [0o41777, "1777"],
  ])("refuses a folder others can open (mode %o)", (mode, shown) => {
    expect(runtimeFolderProblem(folder, { ...mine, mode }, 1000)).toBe(
      `The runtime folder is open to other users (mode ${shown}, it must be 0700): /run/user/1000/goop`,
    );
  });
});
