import { describe, expect, test } from "bun:test";
import {
  CRYPTPROTECT_UI_FORBIDDEN,
  classifyDpapiError,
  DPAPI_ENTROPY,
  DPAPI_RETRY_WAITS_MS,
  viewOrFree,
} from "../../model/dpapi";

describe("DPAPI settings", () => {
  test("the entropy binds the blob to goop's data key, and no prompt is ever shown", () => {
    expect(DPAPI_ENTROPY).toBe("goop-dek-v1");
    expect(CRYPTPROTECT_UI_FORBIDDEN).toBe(0x1);
  });

  test("the retry waits grow and their total outlasts the 20-40 s outage, under a minute", () => {
    expect(DPAPI_RETRY_WAITS_MS).toEqual([1000, 2000, 4000, 8000, 16000, 16000]);
    const total = DPAPI_RETRY_WAITS_MS.reduce((sum, wait) => sum + wait, 0);
    expect(total).toBeGreaterThan(40_000);
    expect(total).toBeLessThan(60_000);
  });
});

describe("DPAPI error codes", () => {
  test.each([
    ["ERROR_ACCESS_DENIED", 0x5],
    ["NTE_BAD_KEY_STATE", 0x8009000b],
  ])("%s is transient on both seal and open", (_, code) => {
    expect(classifyDpapiError("protect", code)).toBe("transient");
    expect(classifyDpapiError("unprotect", code)).toBe("transient");
  });

  test.each([
    ["ERROR_INVALID_DATA", 0xd],
    ["NTE_BAD_DATA", 0x80090005],
    ["an unknown code", 0x1234],
  ])("%s on open is the one open error", (_, code) => {
    expect(classifyDpapiError("unprotect", code)).toBe("open-failed");
  });

  test.each([
    ["ERROR_INVALID_DATA", 0xd],
    ["ERROR_NOT_ENOUGH_MEMORY", 0x8],
  ])("%s on seal is a seal error", (_, code) => {
    expect(classifyDpapiError("protect", code)).toBe("seal-failed");
  });
});

describe("viewOrFree", () => {
  test("returns the view and leaves the native buffer to its caller", () => {
    let freed = 0;
    const view = viewOrFree(
      () => new Uint8Array([1, 2]),
      () => {
        freed++;
      },
    );
    expect(view).toEqual(new Uint8Array([1, 2]));
    expect(freed).toBe(0);
  });

  test("frees the native buffer and keeps the error when the view cannot be built", () => {
    let freed = 0;
    expect(() =>
      viewOrFree(
        () => {
          throw new RangeError("no view");
        },
        () => {
          freed++;
        },
      ),
    ).toThrow("no view");
    expect(freed).toBe(1);
  });
});
