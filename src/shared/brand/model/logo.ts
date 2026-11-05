// The goop logo: a pixel-art flame with two square eyes (design/logo/04-pixel-mascot.html).
// One pixel grid drives every rendering: the SVG assets, the favicon and the TUI splash.

export const LOGO_PALETTE = {
  pink: "#ff5f7a",
  orange: "#ff7a2e",
  yellow: "#ffc24a",
  eye: "#fffaf3",
  pupil: "#1a1412",
} as const;

export type LogoColor = (typeof LOGO_PALETTE)[keyof typeof LOGO_PALETTE];

export interface LogoGrid {
  width: number;
  height: number;
  /** Row-major colors; `null` is a transparent pixel. */
  pixels: (LogoColor | null)[];
}

export interface TerminalCell {
  char: "▀" | "▄" | " ";
  fg: LogoColor | null;
  bg: LogoColor | null;
}

// The flame body, rasterized from the mascot vector. Eyes are stamped afterwards.
// P pink, O orange, Y yellow, . transparent.
const FLAMES = {
  logo: [
    "........................",
    "........................",
    "............Y...........",
    "...........YYY..........",
    "...........YYY..........",
    "...........YYYY.........",
    "..........YYYYYY........",
    "..........OOOOOOO.......",
    "..........OOOOOOOO......",
    "..........OOOOOOOO......",
    ".........OOOOOOOOOO.....",
    ".........OOOOOOOOOOO....",
    "......O..OOOOOOOOOOO....",
    ".....OOO.OOOOOOOOOOOO...",
    "....OOOO.OOOOOOOOOOOO...",
    "....OOOOOOOOOOOOOOOOO...",
    "...OOOOOOOOOOOOOOOOOO...",
    "...OOOOOOOOOOOOOOOOOO...",
    "...OOOOOOOOOOOOOOOOOO...",
    "...OOOOOOOOOOOOOOOOOO...",
    "...OOOOOOOOOOOOOOOOOO...",
    "...PPPPPPPPPPPPPPPPPP...",
    "....PPPPPPPPPPPPPPPP....",
    "....PPPPPPPPPPPPPPPP....",
    ".....PPPPPPPPPPPPPP.....",
    ".....PPPPPPPPPPPPP......",
    ".......PPPPPPPPPP.......",
    ".........PPPPPP.........",
    "........................",
  ],
  favicon: [
    "................",
    "................",
    "........Y.......",
    ".......YYY......",
    ".......YYYY.....",
    ".......OOOOO....",
    "......OOOOOOO...",
    "......OOOOOOO...",
    "....O.OOOOOOOO..",
    "...OOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "..OOOOOOOOOOOO..",
    "..PPPPPPPPPPPP..",
    "...PPPPPPPPPP...",
    "...PPPPPPPPP....",
    ".....PPPPPP.....",
    "................",
  ],
} as const;

const KEYS: Record<string, LogoColor | null> = {
  P: LOGO_PALETTE.pink,
  O: LOGO_PALETTE.orange,
  Y: LOGO_PALETTE.yellow,
  ".": null,
};

/** Square eyes, a pupil half their size in the bottom-right corner, one eye apart. */
function stampEyes(grid: LogoGrid): LogoGrid {
  const { width, height, pixels } = grid;
  const eye = Math.max(2, Math.round(width / 6));
  const pupil = Math.max(1, Math.round(eye / 2));
  const top = Math.round(height * 0.6);
  const first = Math.round(width / 2 - eye * 1.5);
  for (const left of [first, first + eye * 2]) {
    for (let y = 0; y < eye; y++) {
      for (let x = 0; x < eye; x++) {
        const isPupil = x >= eye - pupil && y >= eye - pupil;
        pixels[(top + y) * width + left + x] = isPupil ? LOGO_PALETTE.pupil : LOGO_PALETTE.eye;
      }
    }
  }
  return grid;
}

/** The pixel grid of the logo (24x29) or of the 16 px favicon (16x19). */
export function logoGrid(kind: keyof typeof FLAMES): LogoGrid {
  const rows = FLAMES[kind];
  const width = rows[0].length;
  const pixels = rows.flatMap((row) => [...row].map((key) => KEYS[key] ?? null));
  return stampEyes({ width, height: rows.length, pixels });
}

/**
 * Terminal cells: each holds two pixels. "▀" paints the top pixel with the foreground and the
 * bottom one with the background; "▄" is used when only the bottom pixel is set.
 */
export function halfBlockRows(grid: LogoGrid): TerminalCell[][] {
  const at = (x: number, y: number) =>
    y < grid.height ? (grid.pixels[y * grid.width + x] ?? null) : null;
  const rows: TerminalCell[][] = [];
  for (let y = 0; y < grid.height; y += 2) {
    const row: TerminalCell[] = [];
    for (let x = 0; x < grid.width; x++) {
      const top = at(x, y);
      const bottom = at(x, y + 1);
      if (top) row.push({ char: "▀", fg: top, bg: bottom });
      else if (bottom) row.push({ char: "▄", fg: bottom, bg: null });
      else row.push({ char: " ", fg: null, bg: null });
    }
    rows.push(row);
  }
  return rows;
}

/** A standalone SVG with one crisp square per pixel. */
export function logoSvg(grid: LogoGrid): string {
  const rects: string[] = [];
  grid.pixels.forEach((color, index) => {
    if (!color) return;
    const x = index % grid.width;
    const y = Math.floor(index / grid.width);
    rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`);
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid.width} ${grid.height}" shape-rendering="crispEdges" role="img">`,
    "<title>goop</title>",
    ...rects,
    "</svg>",
    "",
  ].join("\n");
}
