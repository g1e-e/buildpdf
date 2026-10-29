# buildpdf

Combine folders of PDFs into finished documents (like "General Credentialing Documents" and "Health and Physical") on a drag-and-drop board.

Live: https://g1e-e.github.io/buildpdf/

1. Add folders. Each top-level folder becomes a column, each subfolder becomes a card.
2. Drag cards (or single files) into output lists and arrange the order.
3. Click **Build PDF** on a list, or **Build all**.

## Privacy

Everything runs in your browser. Files are never uploaded or sent anywhere: there is no server, no analytics, and the page's Content Security Policy blocks all network requests. Only the board layout (folder and file names) is saved in your browser's local storage, never file contents. Libraries (pdf-lib, SortableJS) are bundled in `lib/`.

## Versioning

`stamp.sh` writes a new version to `version.json` and to the `?v=` asset URLs and version meta tag in `index.html`. The tracked pre-commit hook in `.githooks` runs it on every commit once you run `git config core.hooksPath .githooks` in your clone.
