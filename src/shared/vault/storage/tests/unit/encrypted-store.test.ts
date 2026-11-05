import { describe, expect, test } from "bun:test";
import {
  bindingOf,
  checkCipher,
  checkParameterCount,
  checkStoreKey,
  integerValue,
  openFailure,
  resultCodeName,
  StoreError,
  StoreOpenError,
} from "../../model/encrypted-store";

function thrown(work: () => unknown): Error {
  try {
    work();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("store result codes", () => {
  test.each([
    [5, "busy"],
    [11, "corrupt"],
    [19, "constraint"],
    [21, "misuse"],
    [26, "not-a-database"],
    [2067, "constraint"],
    [999, "error-999"],
  ])("code %d is %s, extended codes by their primary code", (code, name) => {
    expect(resultCodeName(code)).toBe(name);
  });

  test("an unreadable or damaged first page at open is the one open error; other codes are not", () => {
    expect(openFailure(resultCodeName(26))).toBe("wrong-key");
    expect(openFailure(resultCodeName(11))).toBe("wrong-key");
    expect(openFailure(resultCodeName(5))).toBe("error");
    expect(new StoreOpenError().message).toBe(
      "The encrypted store could not be opened: the key is wrong or the file was changed.",
    );
  });

  test("a store error names the operation and the code, nothing else", () => {
    const error = new StoreError("run a statement", "constraint");
    expect(error.message).toBe("The encrypted store could not run a statement: constraint.");
    expect(error.code).toBe("constraint");
  });
});

describe("store key", () => {
  test("only a 32-byte key is accepted, and the error never shows it", () => {
    expect(() => checkStoreKey(new Uint8Array(32))).not.toThrow();
    for (const length of [0, 16, 31, 33]) {
      const key = new Uint8Array(length).fill(0xab);
      const error = thrown(() => checkStoreKey(key));
      expect(error).toBeInstanceOf(StoreError);
      expect(error.message).toBe("The encrypted store could not open: the key is not 32 bytes.");
      expect(error.message).not.toContain("ab");
    }
  });
});

describe("store cipher", () => {
  test("the cipher counts as set only when it is known and the setting took it", () => {
    expect(() => checkCipher("chacha20", 4, 4)).not.toThrow();
    // An unknown name is index -1, and sqlite3mc_config then only reads the current cipher.
    for (const [index, configured] of [
      [-1, 4],
      [4, -1],
      [4, 2],
    ] as const) {
      const error = thrown(() => checkCipher("chacha20", index, configured));
      expect(error).toBeInstanceOf(StoreError);
      expect(error.message).toBe(
        "The encrypted store could not open: the chacha20 cipher is not available.",
      );
    }
  });
});

describe("binding parameters", () => {
  test("each kind of value gets its own SQLite type", () => {
    expect(bindingOf(null)).toEqual({ kind: "null" });
    expect(bindingOf(42)).toEqual({ kind: "int64", value: 42n });
    expect(bindingOf(-0.5)).toEqual({ kind: "double", value: -0.5 });
    expect(bindingOf(2 ** 60)).toEqual({ kind: "double", value: 2 ** 60 });
    expect(bindingOf(2n ** 60n)).toEqual({ kind: "int64", value: 2n ** 60n });
    // Both ends of the signed 64-bit range fit.
    expect(bindingOf(2n ** 63n - 1n)).toEqual({ kind: "int64", value: 2n ** 63n - 1n });
    expect(bindingOf(-(2n ** 63n))).toEqual({ kind: "int64", value: -(2n ** 63n) });
    expect(bindingOf("it's")).toEqual({ kind: "text", value: "it's" });
    const bytes = new Uint8Array([1, 2]);
    expect(bindingOf(bytes)).toEqual({ kind: "blob", value: bytes });
  });

  test("values SQLite cannot hold are refused by position, never by value", () => {
    const cases: [unknown, string][] = [
      [Number.NaN, "parameter 1 is not a finite number"],
      [Number.POSITIVE_INFINITY, "parameter 1 is not a finite number"],
      [2n ** 63n, "parameter 1 does not fit in 64 bits"],
      [-(2n ** 63n) - 1n, "parameter 1 does not fit in 64 bits"],
      [true, "parameter 1 has the unsupported type boolean"],
      [undefined, "parameter 1 has the unsupported type undefined"],
      [{ secret: "x" }, "parameter 1 has the unsupported type object"],
    ];
    for (const [value, reason] of cases) {
      const error = thrown(() => bindingOf(value as never, 1));
      expect(error).toBeInstanceOf(StoreError);
      expect(error.message).toBe(`The encrypted store could not bind a parameter: ${reason}.`);
    }
  });

  test("the statement and the parameters must agree on their count", () => {
    expect(() => checkParameterCount(2, 2)).not.toThrow();
    expect(thrown(() => checkParameterCount(2, 1)).message).toBe(
      "The encrypted store could not bind a parameter: the statement takes 2 and got 1.",
    );
  });
});

describe("reading integers", () => {
  test("safe integers come back as numbers, larger ones as bigints", () => {
    expect(integerValue(7n)).toBe(7);
    expect(integerValue(7)).toBe(7);
    expect(integerValue(2n ** 60n)).toBe(2n ** 60n);
    expect(integerValue(-(2n ** 60n))).toBe(-(2n ** 60n));
    // The boundary: the largest safe integers are numbers, one step past them is a bigint.
    expect(integerValue(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(integerValue(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);
    expect(integerValue(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toBe(2n ** 53n);
    expect(integerValue(BigInt(Number.MIN_SAFE_INTEGER) - 1n)).toBe(-(2n ** 53n));
  });
});
