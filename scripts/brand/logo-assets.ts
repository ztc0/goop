// Regenerates assets/logo.svg and assets/favicon.svg from the logo pixel grid.
// Run it after changing src/shared/model/logo.ts: bun scripts/brand/logo-assets.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { logoGrid, logoSvg } from "@/shared/model/logo";
import { repoRoot } from "../shared/repo-root";

const assets = join(repoRoot(), "assets");
mkdirSync(assets, { recursive: true });
await Bun.write(join(assets, "logo.svg"), logoSvg(logoGrid("logo")));
await Bun.write(join(assets, "favicon.svg"), logoSvg(logoGrid("favicon")));
process.stdout.write("Wrote assets/logo.svg and assets/favicon.svg\n");
