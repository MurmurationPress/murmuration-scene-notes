# PR #1 final review and desktop acceptance

Ted tested Scene Notes 0.1.0 at `db4692bed89ecb770722705d194154cdf43061ac`
and reports **“Working really nicely.”** This records acceptance of that tested
desktop experience only, without inferring mobile acceptance, exhaustive coverage
or acceptance of unsupported migration scenarios. Historical pending wording in
the original report below is superseded by this record.

Final review inspected native following/editing and focus isolation, full-path
mapping/lazy creation, captured serial saves and compare-before-write conflicts,
rename deduplication/collisions, restoration and source preservation. No material
runtime defect was found within the accepted v1 scope. This final-review change
updates records only; runtime source, manifest, styles and dependency versions
remain identical to the accepted head. No licence terms changed: LICENSE and
LICENSING.md preserve MIT software/technical-documentation terms and separate
creative-content/third-party rights.

Fresh local checks: strict typecheck/script syntax, 19 unit tests, production
build and install ZIP inspection. Fresh native checks are recorded in
`docs/evidence/final-review-standalone.json` and
`docs/evidence/final-review-with-mwc.json`, separately from the original run.
They use only disposable synthetic vaults/profiles. Original db4692b evidence
remains applicable to identical runtime; new runs do not imply untested devices
or exhaustive third-party plugin compatibility. GitHub CI is inspected separately;
local passes are not absent CI passes.

Remaining limits are unchanged: mobile and other platforms, offline/delete-create
rename inference, manual sidecar/root migration and moving a notes root with a
containing source folder are not verified/supported here. Cross-device conflict
merging and older API versions are not qualified. The old early-startup timeout
is not erased; fresh startup/restart observations cannot certify every workspace.

---

# Scene Notes 0.1.0 — first implementation

**Status: awaiting Ted’s acceptance.** Original repository head was
`7db4cb8` (brief only). No AGENTS.md existed in this repository or its parent
instruction paths. The original brief is preserved verbatim at `docs/BRIEF.md`.
During implementation Ted added `8e81f516167b27bb9ce0511210a31c91d4515ae6`, selecting MIT for original software/technical documentation and retaining separate creative-content rights. That commit is incorporated, with LICENSE/LICENSING.md unchanged; this implementation does not choose new terms. The preserved brief is the version at that upstream head.
No release or merge is performed.

## Implemented

A right-sidebar, workspace-restorable Scene Notes view, based on the public native
`MarkdownView`/`TextFileView`/`Editor` APIs. One command opens/reuses it. The most
recently active ordinary Markdown source outside current/historical notes roots
is followed; notes focus, notes opened normally, background file opens and
non-Markdown tabs do not replace that source. No MWC import or dependency.

Default mapping `Scene Notes/<complete vault-relative source path>.md` (the source
already has `.md`, so it is not appended twice), configurable through plugin
settings. Opening/switching does not create a sidecar; first nonempty editing does.
Native file context attaches after creation. No source metadata/frontmatter/body
writes, manuscript classification, scene numbering or compiler integration.

Serial per-session writes, optimistic atomic `Vault.process` comparisons, recovery
draft checkpoints, explicit conflict confirmation and guarded external refresh.
Source file/folder moves relocate the sidecars; destination collisions keep both
files and retain an exception association rather than silently inheriting the
other note. A reused old name cannot accidentally share a retained sidecar. A
rename into an unsaved orphan session is reported for manual resolution instead
of discarding its draft. Deleting a source does not delete notes. Root-setting
changes retain old associations/exclusions in place and create new files only
on later deliberate editing. No bulk migration is attempted.

## Automated checks

- `npm run check`: strict TypeScript and all development-script syntax checks pass.
- `npm test`: **19 tests pass**, zero failures/skips. Vault-independent fixtures
  cover path mapping, duplicate filenames, Unicode/spaces, invalid paths and roots,
  lazy creation, in-flight edits, clean/empty notes, rename/move/collision handling,
  exception persistence, filename reuse, external changes, conflict resolution,
  deletion, checkpoint/write failures, recovery and duplicate folder/child events.
- `npm run package`: typecheck and production build pass; CommonJS `main.js`
  **28,461 bytes** (about 27.8 KiB), only Obsidian external. No editor/runtime npm
  dependency is bundled. Production-dependency audit reports zero vulnerabilities.
- ZIP inspection: exactly the plugin folder and `main.js`, `manifest.json`,
  `styles.css`, `LICENSE` and `LICENSING.md`; bytes match both native installations. No test vault/profile,
  evidence, manuscript, MWC bundle, private data or development dependencies.
  See `docs/evidence/package.json` for checksums.

## Actual Obsidian checks

The actual app reports **Obsidian 1.13.7 / Linux**, Electron 43.3.0. Files installed
into newly allocated `/tmp` synthetic vaults with separate application profiles.
Product code uses public Obsidian APIs only; the development driver uses test-only
CDP/application inspection and Chromium text input. No Ted vault or manuscript was
opened or modified. These are automated observations of the native app, not
human acceptance or browser-only mocks.

`docs/evidence/native-standalone.json` records:

- Open command; empty native editing surface; no sidecar/root on browsing.
- First edit using native editor focus and Chromium text input creates the exact
  mirrored note, preserving Markdown headings/emphasis/wikilinks and its native
  file context; sidebar focus retains its source.
- Equal source basenames in different folders get distinct note contents.
- Eight rapid source switches with native edits preserve each file independently.
- Revisiting restores the selected text range and scroll top (166 px in this
  fixture) through the public Editor API; source focus is not moved by following.
- Source file rename and containing-folder move preserve note association and
  manuscript bytes. The fixture includes a manuscript link to its note; sidecar
  relocation does not rewrite it. Destination collision retains both files and
  reports the old path. Source deletion leaves notes intact.
- Opening the underlying sidecar as ordinary Markdown, editing/saving it, and
  returning refreshes the panel without following the note as a new source.
- Actual filesystem writes refresh clean text via Obsidian’s vault watcher.
- **Fault-injected slow save** (own checkpoint delayed, no fake Vault/storage)
  plus an actual external filesystem write leaves the external version unchanged
  and the local draft visible. Cancelling confirmation keeps the draft; explicitly
  confirming reload selects the saved version. Real `Vault.process` handles the
  compare/write; this observation is distinguished from normal untampered timing.
- Canvas/non-Markdown activation retains the last source. Deleting the current
  source caused Obsidian to activate another Markdown tab, which the panel then
  followed; the deleted source’s notes remained on disk.
- New configured root creates lazily while old associations remain valid.
- A 300 px sidebar has zero horizontal overflow. Controls wrap and the writing
  surface remains native Markdown.
- Closing during an edit flushes it to the bound sidecar; reopening shows that
  saved text. Detached views reject late load/binding callbacks.
- Cold restart restores **one** sidebar and its saved collision association, text,
  and custom view state. No native runtime exceptions in the final run.

`docs/evidence/native-with-mwc.json` repeats the full workflow, including external-filesystem/slow-save conflict
checks and close-time saving, alongside the
available local **MWC manifest 0.20.0** bundle, with its exact hash recorded. It
passes the note/focus/move/root/restart/source-preservation checks. This is a
coexistence smoke, not a qualification of all MWC features or compilation. The
independent run has no MWC installed. MWC source/bundle is neither modified nor
included in this repository or install ZIP.

## Investigation and limits

Development native failures were investigated rather than counted as passes:

- A test initially opened a source in a background pane while notes stayed active;
  the panel correctly retained the last active source. The driver now explicitly
  activates the source pane. Another check observed the next session identity
  before its native editor finished loading; the product now hides the stale
  editor during transition, and tests wait for rendered data/readiness.
- Folder moves can emit both folder and child-file rename events. Reprocessing one
  incorrectly looked like a collision; file-identity deduplication and a focused
  regression fix that defect. Later checks confirm no spurious exception remains.
- The custom state originally reused native Markdown’s `source` key. State and
  subclass fields are now namespaced so native source-mode state stays a boolean.
  One early startup observation timed out although the empty panel was already
  rendered; its exact timing cause was not established. Final complete standalone
  and alongside-MWC runs, including cold restarts, pass; this does not establish
  exhaustive startup stability across all other plugins/workspaces.
- The ordinary-editor driver also needed to wait for its actual file contents,
  not merely its file pointer. Deletion checks were corrected to account for
  Obsidian selecting another tab after deleting the active source. These are
  observation corrections, not claims that the plugin should prevent native tabs
  from switching. Test-script construction errors were fixed before final checks.

Actual mobile/iPad, Windows/macOS, physical touch/keyboard, assistive technologies,
older supported API versions and third-party themes/plugins beyond the scoped MWC
smoke remain unverified. The manifest is mobile-eligible, not mobile-certified.
Native history/Undo is not separately retained between file switches. Changes to
selection after a shorter external file are best-effort. The normal workspace
mechanism restores panels; plugin reload is not a new persistence/progress system.

Use Obsidian renames while enabled. Offline/delete-and-create renames and manual
sidecar/root migration are not inferred. Keep the notes root separate from source
folders you plan to move: moving the root together with a containing source
folder is not a supported root migration in this first version. No content-based
matching or source rewriting is used to guess such associations. Old Markdown
files remain available for manual recovery. Cross-device Sync conflict merging
and large-vault/performance qualification are outside these checks.

The repository has no configured GitHub Actions workflow; local checks are not
GitHub CI passes. MIT terms and the creative/third-party scope remain exactly as selected by Ted in upstream LICENSE/LICENSING.md.
