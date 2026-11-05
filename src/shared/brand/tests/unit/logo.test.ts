import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { halfBlockRows, LOGO_PALETTE, type LogoGrid, logoGrid, logoSvg } from "../../model/logo";

const repo = resolve(import.meta.dir, "..", "..", "..", "..", "..");

function rows(grid: LogoGrid): string[] {
  const letters: Record<string, string> = {
    pink: "P",
    orange: "O",
    yellow: "Y",
    eye: "W",
    pupil: "K",
  };
  const keys = new Map(Object.entries(LOGO_PALETTE).map(([name, value]) => [value, letters[name]]));
  const lines: string[] = [];
  for (let y = 0; y < grid.height; y++) {
    let line = "";
    for (let x = 0; x < grid.width; x++) {
      const color = grid.pixels[y * grid.width + x];
      line += color ? (keys.get(color) ?? "?") : ".";
    }
    lines.push(line);
  }
  return lines;
}

describe("logoGrid", () => {
  test("the logo is a 24x29 grid that uses only the five palette colors", () => {
    const grid = logoGrid("logo");

    expect(grid.width).toBe(24);
    expect(grid.height).toBe(29);
    expect(grid.pixels).toHaveLength(24 * 29);
    for (const color of grid.pixels) {
      if (color !== null) expect(Object.values(LOGO_PALETTE)).toContain(color);
    }
  });

  test("the logo has square eyes with the pupil in the bottom-right corner, one eye apart", () => {
    const eyes = rows(logoGrid("logo")).slice(17, 21);

    expect(eyes.map((line) => line.slice(6, 18))).toEqual([
      "WWWWOOOOWWWW",
      "WWWWOOOOWWWW",
      "WWKKOOOOWWKK",
      "WWKKOOOOWWKK",
    ]);
  });

  test("the favicon is a 16x19 grid with eyes scaled to it", () => {
    const grid = logoGrid("favicon");
    const eyes = rows(grid).slice(11, 14);

    expect([grid.width, grid.height]).toEqual([16, 19]);
    expect(eyes.map((line) => line.slice(4, 13))).toEqual(["WWWOOOWWW", "WKKOOOWKK", "WKKOOOWKK"]);
  });
});

describe("halfBlockRows", () => {
  const P = LOGO_PALETTE.pink;
  const O = LOGO_PALETTE.orange;
  const tiny: LogoGrid = {
    width: 4,
    height: 3,
    pixels: [P, P, null, null, O, null, O, null, O, O, null, null],
  };

  test("packs two pixels per terminal cell, like the upper half block does", () => {
    expect(halfBlockRows(tiny)).toEqual([
      [
        { char: "▀", fg: P, bg: O },
        { char: "▀", fg: P, bg: null },
        { char: "▄", fg: O, bg: null },
        { char: " ", fg: null, bg: null },
      ],
      [
        { char: "▀", fg: O, bg: null },
        { char: "▀", fg: O, bg: null },
        { char: " ", fg: null, bg: null },
        { char: " ", fg: null, bg: null },
      ],
    ]);
  });

  test("the logo takes 15 terminal rows of 24 cells", () => {
    const cells = halfBlockRows(logoGrid("logo"));

    expect(cells).toHaveLength(15);
    for (const row of cells) expect(row).toHaveLength(24);
  });
});

describe("logoSvg", () => {
  test("draws one crisp square per pixel, with an accessible title", () => {
    const grid = logoGrid("logo");
    const svg = logoSvg(grid);

    expect(svg).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 29"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain("<title>goop</title>");
    expect(svg.match(/<rect /g)).toHaveLength(grid.pixels.filter((color) => color !== null).length);
    expect(svg).not.toContain("http://www.w3.org/1999/xlink");
  });

  test("the committed assets match the logo data", async () => {
    expect(await Bun.file(join(repo, "assets", "logo.svg")).text()).toBe(logoSvg(logoGrid("logo")));
    expect(await Bun.file(join(repo, "assets", "favicon.svg")).text()).toBe(
      logoSvg(logoGrid("favicon")),
    );
  });
});
