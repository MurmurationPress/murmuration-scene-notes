# Murmuration Scene Notes

A small, standalone Obsidian plugin: an editable **Scene Notes** sidebar follows the Markdown document you are writing. Planning text lives in ordinary Markdown sidecars, not in the manuscript. No MWC dependency, classification metadata, AI, publishing or manuscript insertion.

Version 0.1.0 is a first implementation **awaiting Ted’s acceptance**. The original project brief is preserved in [docs/BRIEF.md](docs/BRIEF.md); [RESULTS.md](RESULTS.md) separates automated tests, actual Obsidian observations and limitations. Ted selected the **MIT licence** in repository commit `8e81f516167b27bb9ce0511210a31c91d4515ae6` during implementation. [LICENSE](LICENSE) covers original software/technical documentation; [LICENSING.md](LICENSING.md) preserves separate creative-content and third-party rights. This task follows that decision and publishes no release.

## Install the local test build

1. Use a disposable vault first. Close Obsidian for that vault.
2. Extract `dist/murmuration-scene-notes-0.1.0.zip` into `<vault>/.obsidian/plugins/`. It contains the folder `murmuration-scene-notes/` with **main.js**, **manifest.json**, **styles.css**, **LICENSE** and **LICENSING.md**. Alternatively create that folder and copy those three runtime files and both licence files into it.
3. Start Obsidian, allow community plugins for this test vault, and enable **Murmuration Scene Notes** under Settings → Community plugins.
4. Open a Markdown document. Run **Murmuration Scene Notes: Open Scene Notes** from the Command Palette. This opens/reuses the right-sidebar panel. Start typing your planning notes there.

Open the panel once; after that it follows documents automatically while open. Obsidian’s normal workspace restoration reopens it on restart. The plugin does not force a closed panel open on every startup. Minimum API version is 1.8.0; see RESULTS for the actual tested app/version/platform. Mobile APIs are used where available, but actual mobile/iPad operation is unverified.

## Which document does it follow?

The most recently **active Markdown view outside the notes roots** is the source. This applies to ordinary Markdown in any editor pane, without book/scene metadata. Selecting a different pane/document changes the notes. Opening a document in a background pane does not count as activating it.

Clicking/typing in Scene Notes, opening a sidecar as an ordinary document, switching to a non-Markdown tab, or opening settings retains the last source. The panel shows its full vault-relative path so equal filenames are distinguishable. A source switch flushes/captures the old session, discards stale loads and briefly hides its old editor surface while the next one loads. It does not focus the sidebar or move the manuscript cursor. Native Markdown editing, formatting, selections, Undo and links use Obsidian’s editor; no custom rich-text editor or CodeMirror internals are used.

Selection and scroll are remembered for each source during the session, and for the current panel through workspace state. Native history/Undo is not separately retained across file switches. Background/external edits may require Obsidian to adjust a selection if the document became shorter.

## Storage and paths

Default root: **`Scene Notes/`**, configurable in Settings → Murmuration Scene Notes → Notes root → Apply.

| Source | Default sidecar |
| --- | --- |
| `Books/Harbour/Arrival.md` | `Scene Notes/Books/Harbour/Arrival.md` |
| `Books/Hill/Arrival.md` | `Scene Notes/Books/Hill/Arrival.md` |
| `Sketch.md` | `Scene Notes/Sketch.md` |

The complete vault-relative source path is mirrored, including spaces and Unicode. Paths must remain relative to the vault, without hidden folders, drive prefixes, `.` or `..` segments. The plugin creates no sidecar/folders merely by viewing a source; the first nonempty deliberate edit creates them. Clearing an existing note saves an empty Markdown file rather than deleting it. There is no inserted frontmatter, backlink property, manuscript type, book membership or scene order metadata. Sidecars can travel through Obsidian Sync/Git as normal Markdown.

A root change preserves existing sidecars and their associations in place; it applies the new root to new sources. Old and new roots stay excluded from source tracking. This is not a bulk migration. The root must not contain a tracked manuscript. Plugin preferences, collision exceptions and temporary recovery drafts are kept in the plugin’s normal `data.json`, separate from manuscript/sidecar Markdown. In normal use the sidecar is the source of truth.

**Open note as document** opens an existing sidecar in a normal Obsidian tab; it never creates one. Editing that file elsewhere refreshes the sidebar. Relative links/images in notes use the sidecar’s own location, as ordinary Obsidian Markdown does. Disabling the plugin leaves all sidecars readable.

## Saving, conflicts and moves

Edits save immediately through a serial queue bound to the original source/session, not whichever document is active when a write completes. Updates use the public `Vault.process` API to compare the saved baseline before replacing content. Switching rapidly cannot route an old callback into the new sidecar.

Clean external changes refresh automatically. If saved text changes while a local draft is unsaved, the panel preserves the draft and displays **Unsaved** with recovery controls. Open the saved note to compare. **Use saved version…** discards the local draft only after confirmation; **Keep my draft…** explicitly replaces the latest saved contents after confirmation and an atomic comparison. **Retry save** handles transient write failures, without bypassing conflicts. Recovery drafts are checkpointed in plugin data before writing. Resolve an Unsaved warning before treating a note as safely synced; no silent last-writer-wins conflict policy is added.

Source file/folder renames and moves reported by Obsidian move the corresponding sidecars, creating destination folders as needed. Duplicate child/folder rename events are deduplicated by file identity. Sidecar moves use `Vault.rename`, so the plugin does not rewrite links or other manuscript text. A source rename performed by Obsidian itself retains Obsidian’s usual link-update behaviour.

If a destination already exists, **neither file is overwritten**. The old sidecar remains associated with the renamed source through a persisted exception; a notice identifies both paths. You can continue writing there. No automatic merge is attempted. Deleting a source never deletes its notes. The panel identifies a missing source if it remains selected; if Obsidian activates another Markdown tab after closing the deleted file, the panel follows that newly active document.

Renames while the plugin is disabled, or Sync/filesystem changes reported only as separate deletion/creation events, cannot be inferred safely. Old sidecars remain intact; mirror/move the files deliberately to restore the default association. Manually moving a sidecar independently of its source is not an automatic association migration. Keep the notes root separate from source folders you plan to move: moving that root together with a containing source folder is not supported root migration in this first version. Notes are not a version-history or cross-device conflict-resolution system.

## Development and validation

Node.js 22+ and npm; `zip` is needed only to make the install ZIP.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run package
```

`npm run dev` watches the source; reload the plugin in your disposable vault after copying the three install files. Production build is a small CommonJS bundle with only `obsidian` external, following the [official sample plugin build pattern](https://github.com/obsidianmd/obsidian-sample-plugin/blob/master/esbuild.config.mjs). There are no runtime npm dependencies, network calls or MWC imports.

- `src/model.ts`: vault-independent association, serial writes, snapshots/conflicts and rename-event identity guard.
- `src/main.ts`: public [MarkdownView/TextFileView and Editor APIs](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts), sidebar lifecycle, vault adapter and settings. Native save hooks are replaced with the guarded session store; no private editor access or app patching.
- `test/model.test.ts`: deterministic storage/path/race fixtures; no Obsidian runtime.
- `scripts/native-smoke.mjs`: optional actual Obsidian/Linux check. Run `node scripts/native-smoke.mjs /tmp/scene-notes-evidence.json` after building, in a graphical Linux session with `/opt/Obsidian/obsidian` (or `OBSIDIAN_EXECUTABLE`). It allocates only `/tmp` synthetic vault/profile files. Test-only CDP/Chromium input inspects the native app; the shipped plugin has no CDP/Electron code. The disposable Electron process uses `--no-sandbox` for the test harness; normal installation needs no security changes.

## Acceptance checklist

- Open two Markdown documents with the same filename in different folders; open Scene Notes once. Browse without typing: no sidecar yet.
- Write headings, paragraphs and links in each panel. Focus the sidebar, then the manuscript: association stays correct. Switch rapidly while editing; check the two saved sidecars.
- Revisit a source and check selection/scroll. Open its sidecar normally, edit it, and return to the sidebar.
- Rename/move a source and a containing folder. Check the note follows. Test a collision in a disposable vault and check both files survive and the notice names the retained sidecar.
- Restart Obsidian: one sidebar, correct source and saved content. Try a narrow sidebar, non-Markdown tabs and multiple panes.
- Confirm source text/frontmatter is unchanged. Disable the plugin and read the sidecars normally.

Nothing is merged or released by this implementation task. See RESULTS for checks actually performed rather than treating this checklist as evidence.
