/*
 * ZIM Reader is a plain-JS plugin — main.js is the source, there's no build.
 * This copies the working files into the installed plugin inside the Obsidian
 * vault. Edit here, then run `node deploy.mjs` and reload Obsidian.
 * If the vault ever moves, update this one path.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";

const VAULT_PLUGIN = "D:/Obsidian/mrrepac/.obsidian/plugins/zim-reader";

mkdirSync(VAULT_PLUGIN, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css", "versions.json"]) {
  if (existsSync(f)) {
    copyFileSync(f, `${VAULT_PLUGIN}/${f}`);
    console.log("→", f);
  }
}
console.log("deployed to", VAULT_PLUGIN);
