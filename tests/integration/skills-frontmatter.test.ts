import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const skills = resolve(import.meta.dir, "..", "..", ".agents", "skills");

function frontmatter(file: string): Record<string, unknown> {
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file} has no frontmatter`);
  return Bun.YAML.parse(match[1] ?? "") as Record<string, unknown>;
}

test("every project skill has a name, a description and its author and version under metadata", () => {
  const names = readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  for (const name of names) {
    const data = frontmatter(join(skills, name, "SKILL.md"));

    expect({ name, keys: Object.keys(data).sort() }).toEqual({
      name,
      keys: ["description", "license", "metadata", "name"],
    });
    expect(data.name).toBe(name);
    expect(data.metadata).toEqual({ author: "ztc0", version: "1.0" });
  }
});
