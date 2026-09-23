# Workflow: build, launch, debug, commit

## Build and launch

Two processes. The webpack build writes to `dist/` on disk; Electron loads `dist/`
from the filesystem.

```bash
npm run webpack:dev        # one-shot build into dist/
npm run webpack:dev-watch  # rebuild dist/ on change — leave running
npm run start              # tsc the electron main process, then launch Electron
```

Normal loop: leave `webpack:dev-watch` running in one terminal, re-run `npm run start`
in another after each change.

### Never run `npm run dev`

`npm run dev` is `webpack serve`. The config keys `publicPath` off
`isDevServe = !isProd && process.argv.includes('serve')`, so under the dev server it
emits absolute paths like `src="/launcher/launcher.js"`. Electron loads over `file://`,
where `/launcher/...` resolves to the **drive root**. Result: a black window, no error
in the console, nothing obviously wrong. If the Electron window is black, this is the
first thing to check — and kill any stray dev server, because it also fights the
watcher over `dist/`.

`dist/` is a real build output on disk, not served from memory. It does not need
"refreshing" beyond the watcher; compare mtimes if you suspect staleness.

## Type check

```bash
npx tsc --noEmit -p tsconfig.kotorjs.json
```

Run this before every commit. It is the only automated gate we have — there is a Jest
setup (`npm test`) but no meaningful coverage of engine behavior, so it will not catch
what we break.

## Verifying a change actually shipped

esbuild strips comments inconsistently, so **grepping `dist/` for a comment you added
proves nothing**. Grep for a distinctive code string instead, or compare source and
bundle mtimes. Also note webpack puts each module on one line, so `grep -c` counts
matching *lines*, not occurrences — use `grep -o ... | wc -l`.

## Reading the runtime console

The user plays in Electron and pastes the DevTools console. Things worth knowing:

- `SetEngineMode: N` maps to `EngineMode`: `-1` LOADING, `0` GUI, `1` INGAME,
  `2` MINIGAME, `3` DIALOG, `4` FREELOOK, `5` MOVIE, `6` LEGAL. A burst of rapid
  flips between two modes is a bug; two or three per transition is normal.
- `RestoreEnginePlayMode: INGAME` after a `PlayMovie` means module init finished and
  clobbered MOVIE mode while the video was still playing. That is the known cause of
  area audio bleeding under a cutscene.
- Repeated identical stack traces at ~60/second are almost always the unguarded-throw
  pattern: something in a per-frame update threw and was never dequeued.
- `Resource not found: ResRef: <name>` names a missing resource precisely — trust it.
- `TextureLoader: '<name>' failed to resolve` is our own diagnostic; it fires once per
  texture name and explains white surfaces and white GUI icons.

Console dumps are long. Search for `Uncaught`, `Error`, `warn`, and `Resource not
found` first, then read around the *first* occurrence — later ones are usually the
same failure repeating.

## Commit conventions

- Work on a topic branch. `tsl-prologue-fixes` is the current one.
- Commit locally. Do not push and do not open an upstream PR without being asked —
  that is an explicit standing decision.
- Subject line says what changed in the imperative. Body explains the mechanism: what
  the code did, why that was wrong, what the symptom looked like. These commits double
  as the bug log for the project.
- Footer: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## Environment notes

- Windows 11. The shell is Git Bash for `Bash`, PowerShell for `PowerShell` — they
  take different syntax.
- Saves live under the game directory's `saves/`; `gameinprogress/` holds the
  autosave working set that the engine exports on module transition.
- The renderer process has been observed at ~8.9 GB with load times climbing across
  successive loads. Treat memory growth as an open, unexplained issue — it has already
  caused visible failures (Bink decode running out of buffer during the intro movie).
