# Murmuration Scene Notes

A small standalone Obsidian plugin for keeping a planning note beside the scene it belongs to.

**Status:** project brief; implementation has not started.

## Why

When starting a book, scene ideas, research, questions and possible endings often accumulate inside the manuscript itself. Separate companion pages already offer somewhere to put them, but remembering to open and arrange the right page interrupts writing.

Scene Notes keeps the right planning document beside the active manuscript document automatically.

## Agreed scope

- Planning content lives in a separate, ordinary Markdown file. That file is the source of truth.
- No planning content in the source document's body or frontmatter.
- Show the companion in a normal editable Obsidian Markdown view, retaining native editing and links.
- Follow the active source document automatically while the notes pane is open.
- Focusing or editing the companion must retain its association with the source; it must not trigger notes about notes.
- Provide a create/open notes command. Do not generate empty companions for every scene merely by browsing.
- Keep the open pane reusable rather than opening a new tab for each scene.
- Support scenes, parts and books through the same association mechanism.
- Operate independently of Murmuration Writing Companion. This project must not add to MWC's bundle or require it to be installed.
- Keep the first release small. Pinning a companion is a useful follow-up if it complicates the initial implementation.

## Design to settle during implementation

Choose and document a predictable association and storage convention before writing note-management code. Consider full vault-relative paths, duplicate scene names, existing companion files and renames/moves. A small link property is acceptable if needed; the planning text itself always remains in the companion file.

Use Obsidian's own Markdown editor rather than building a second rich-text editor. Prefer public APIs and avoid adding a heavy editor dependency.

Companion files must not be mistaken for manuscript scenes. Document their metadata/location convention and verify compatibility with MWC and Codex Press discovery where available, without modifying those projects.

The sidecar must not steal focus while the author writes, lose unsaved edits when scenes change, or overwrite a pre-existing file. Missing notes should offer creation rather than displaying another scene's notes as if they belong to the current one.

Desktop is the first acceptance environment. Investigate mobile compatibility and state the actual supported platforms; do not claim iPad acceptance without testing it.

## First implementation acceptance

1. Open a scene with no notes: offer to create its companion without changing the scene.
2. Create notes, write several paragraphs with headings and wikilinks, then restart Obsidian: the Markdown file retains the content.
3. Switch between two scenes: the same notes pane follows the source and shows the correct companion.
4. Focus and edit the notes: the binding remains with the source.
5. Change scenes rapidly and return: edits remain with the correct files, with no focus stealing or duplicate panes.
6. Close and reopen the notes pane: the current scene's companion opens correctly.
7. Verify the chosen rename/move behaviour and same-basename handling; never overwrite another companion.
8. Disable the plugin: all notes remain readable and editable as ordinary Markdown files.
9. Confirm source bodies and planning content in frontmatter remain untouched; document any association property the author elects to use.
10. Check the plugin without MWC installed, then exercise it alongside MWC in a disposable vault.

Use meaningful automated checks for association and file safety, plus hands-on Obsidian checks for focus, native editing and following. Report untested platform behaviour explicitly.

## Outside the first release

Annotations, excerpt cards, AI assistance, manuscript indexing, publishing, automatic bulk migration, and changes to MWC.

Existing planning material in PrimeTrilogy must remain untouched until a separate migration is requested.

## Development handoff

Once the current Codex task is finished, implement this brief on a feature branch, open a reviewable PR and provide an installable test build with a short acceptance checklist. Leave the implementation PR unmerged for Ted's acceptance. No licence has been selected yet; do not choose one implicitly.
