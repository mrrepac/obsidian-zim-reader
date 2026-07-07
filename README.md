# ZIM Reader

Read offline **ZIM** archives — the format used by [Kiwix](https://kiwix.org) for
offline Wikipedia and other wikis — directly inside Obsidian. Point the plugin at a
local `.zim` file, search by title, and read articles with working internal links and
images, without any external server or process.

Everything is read on demand straight from disk: only the file header, the search
indexes, and one decompressed cluster at a time are ever touched, so a 38 GB
Wikipedia archive opens instantly and uses almost no memory.

## Usage

1. Enable the plugin.
2. In **Settings → ZIM Reader**, set the full path to your `.zim` file
   (e.g. `D:\archives\wikipedia_ru_all_maxi_2026-02.zim`).
3. Open the reader from the ribbon (book icon) or the command
   **Open ZIM Reader**.
4. Type a title in the search box, pick a result, and read. Internal links,
   the *Random article* button, and back/forward all work.

Where to get `.zim` files: <https://library.kiwix.org>.

## Notes

- **Desktop only.** ZIM archives are often tens of gigabytes and need random-access
  file reads, which the mobile app cannot provide.
- **Zstandard** compression is supported (modern ZIM). Full-text (Xapian) search is
  not implemented yet — search is by article title.
- Articles are rendered in a clean, theme-aware reading layout rather than the
  original wiki skin.

## Credits

Zstandard decompression by [fzstd](https://github.com/101arrowz/fzstd) (MIT),
inlined into `main.js` (see `fzstd-LICENSE`). ZIM is an open format by the
[openZIM](https://openzim.org) project.

## License

MIT
