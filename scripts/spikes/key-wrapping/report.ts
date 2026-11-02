// T11 spike report: collects PASS/FAIL per item, prints them and exits 1 on any FAIL.

export interface Report {
  check(item: string, body: () => Promise<string>): Promise<void>;
  finish(): never;
}

export function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function createReport(title: string): Report {
  const results: { item: string; ok: boolean; detail: string }[] = [];
  return {
    async check(item, body) {
      try {
        results.push({ item, ok: true, detail: await body() });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        results.push({ item, ok: false, detail });
      }
    },
    finish() {
      const compiled = import.meta.path.startsWith("/$bunfs/") || import.meta.path.includes("~BUN");
      const lines = [`${title} (${compiled ? "compiled" : "source"}, Bun ${Bun.version})`];
      for (const { item, ok, detail } of results) {
        lines.push(`${ok ? "PASS" : "FAIL"} ${item}: ${detail}`);
      }
      process.stdout.write(`${lines.join("\n")}\n`);
      process.exit(results.every((result) => result.ok) ? 0 : 1);
    },
  };
}

/** Constant-time comparison is not needed in a spike; this only proves the bytes match. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** True when `needle` appears anywhere inside `haystack`. */
export function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}
