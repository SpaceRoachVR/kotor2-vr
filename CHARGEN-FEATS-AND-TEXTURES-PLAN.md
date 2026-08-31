# Plan — feat selection, and the missing GUI textures

Written 2026-08-31 from manual-test reports on custom character creation. Every
claim below is measured against the running build with the two mod layers
loaded, not inferred.

## Where the magenta squares come from

`TextureLoader` substitutes a magenta/dark diagnostic checker when a texture
cannot be resolved. On the feats screen the router reports `lbl_indent` (68
requests) and `lbl_skarr` (40) as `missing / missing-required-texture` after
searching **all five** sources — `override-tpc`, `override-tga`,
`active-module`, `gui-pack`, `texture-pack`, `key-bif`.

They are absent from the retail install. Searching the archives directly:

| resref | `swpc_tex_gui.erf` | `swpc_tex_tpa.erf` |
|---|---|---|
| `lbl_indent` | absent | absent |
| `lbl_skarr` | absent | absent |
| `bluefill` | absent | absent |
| `yellowfill` | absent | absent |
| `load_default` (control) | **present** | — |
| `blackfill` (control) | **present** | — |

The two controls confirm the search method works, so the absences are real.

**These are K1 texture names, hard-coded into shared code.**
`src/game/kotor/gui/GUIFeatItem.ts` calls
`TextureLoader.enQueue('lbl_indent', …)` at line 102 and
`TextureLoader.enQueue('lbl_skarr', …)` at line 180. TSL inherits that class,
so every TSL feat row asks for a texture that only K1 ships. The authored TSL
GUI names its own border texture; the hard-coded call discards it.

`bluefill` / `yellowfill` / `confirm1` / `confirm2` are already on the gate's
known-absent list of 14, so they are the same class of problem elsewhere.

### FIXED 2026-08-31 — and the real cause was not the missing textures

The absent K1 resrefs were real but were only the *first* of four layers. Each
was found by measuring rather than reading, after several wrong inferences:

1. **The magenta checker is now opt-in** (`?texdiag=1`, or
   `localStorage kotor2vr.texdiag`). It changes only what is drawn; the router
   still records every miss, so `vr:check`'s `texture-resolution-baseline`,
   which counts distinct failures from the router and not from pixels, is
   unaffected. The existing test asserted the old default and was extended to
   cover both modes rather than weakened.
2. **Clearing a map is not enough** — an unmapped material still draws, as
   opaque white, which is what the checkers became. `TextureLoader
   .hideUnresolvedFill` and `GUIFeatItem.hideFill`/`showFill` hide a fill until
   its texture actually loads, so K1 is unchanged and TSL draws nothing.
3. **The real cause of the white grid: a stale render target.** `GUIListBox`
   draws its rows into an RTT that is published once. Texture loads complete
   *after* that publish, so the icons arrived into a scene nobody re-rendered
   and the list kept showing its pre-load frame indefinitely. Proof: hiding all
   132 unmapped meshes in the list live changed the picture not at all. Every
   other thing that alters a row marks the list dirty; a late texture now does
   too — `this.list?.markListRttDirty?.()` in the load callbacks. The feat
   icons render correctly with this in place.
4. **Mod textures broke icon sizing.** The sprite was scaled to
   `texture.image.width`. Retail icons are 32x32 so that happened to agree, but
   a replacement pack ships the same icon at higher resolution — one UCO Redux
   icon drew several times its slot and spilled outside the grid. Icons are now
   sized from the slot.

Point 3 generalises: **any list row whose appearance depends on an async load
needs to mark the list dirty**, and equipment/inventory/journal rows are all
built the same way. Worth a sweep.

### Sweep done 2026-08-31 — four more offenders

Every row class was checked by comparing its count of asynchronous texture
loads against its count of RTT invalidations:

| Row class | async loads | invalidations before | after |
|---|---|---|---|
| `kotor/gui/GUIFeatItem` | 3 | 3 (fixed earlier) | 3 |
| `tsl/gui/GUIFeatItem` | 3 | **0** | 3 |
| `tsl/gui/GUISpellItem` | 3 | **0** | 3 |
| `tsl/gui/GUIInventoryItem` | 1 | **0** | 1 |
| `tsl/gui/GUICreatureSkill` | 1 | **0** | 1 |
| `tsl/gui/GUIJournalItem` | 0 | — | — |

So the powers list, the TSL abilities feat list, inventory/equipment rows and
the creature-skill rows all carried the same latent fault. **The journal is
genuinely exempt** — its rows are text and load no textures, which the test
asserts so the exemption stays honest rather than looking like an oversight.

`tsl/gui/GUISpellItem` also carried the **same icon-sizing bug**: sprites scaled
to `texture.image.width`, which agrees with retail's 32x32 icons but draws a
mod's higher-resolution replacement far outside its slot. Fixed there too.

Worth noting `tsl/gui/GUIFeatItem` exists and is a *different* class from the
one the chargen screen uses — TSL's `CharGenFeats` inherits `show()` from the
K1 class, so the chargen fix never touched the abilities-screen version. The
two are easy to confuse.

Guarded by `src/tests/list-row-rtt-invalidation.test.ts`, which asserts one
invalidation per async load across the family, rejects texture-derived icon
sizing, and pins the journal's exemption.

Verified: `vr:check` 25/25 against the real build with both mod layers. Missing
texture *requests* fell from 92 to 41 (distinct failures unchanged at 14).

### Original fix order, retained for reference

1. **Use the authored border fill.** The GUI file already specifies a texture
   for the proto item's border; take it from the control instead of naming one
   in code. This is game-agnostic and fixes K1 and TSL together.
2. **Fall back to the hard-coded K1 name** only when the authored fill is
   absent, so K1 behaviour is unchanged.
3. **Stop drawing the diagnostic checker for absent decorative GUI textures.**
   Retail draws nothing. Keep the checker behind a debug flag — it is genuinely
   useful, it is just not shippable as the default. This also clears the
   remaining known-absent 14 from the player's view without hiding them from
   the gate, which asserts on the router's own count rather than on pixels.

A sweep for other hard-coded resrefs in `src/game/kotor/**` should follow: the
same K1-name-in-shared-code mistake will exist elsewhere, and it is invisible
until someone opens the right TSL screen.

## Feat selection

`CharGenFeats`'s own header already records that `BTN_SELECT` and
`BTN_RECOMMENDED` were never implemented. What exists now:

- `addGrantedFeats()` awards every feat the class is entitled to on `show()`,
  so a custom character leaves the screen valid even with no picks made.
- `buildFeatList()` builds the chain-grouped list.
- **New 2026-08-31:** `getRemainingFeatSelections()` reads the real allowance
  from `featgain.2da` via `CreatureClass.featGainPoints[level-1]`, and
  `describeFeat()` fills the name and description panels on hover from
  `TalentFeat.name` / `.description` TLK references.

### Upstream is not a source for this

`git log upstream/master` on `CharGenFeats.ts` / `GUIFeatItem.ts` shows the last
touches are the generic `feat: menu refactor` / `refactor: simplify item
management` commits. Diffing upstream against this fork on those two files
gives **13 insertions against 75 deletions** — upstream has *less* than we do.
Its recent activity is Forge and tooling. This matches the standing finding
that upstream is not finishing the runtime engine; the fork is.

### DONE 2026-08-31 — selection, recommend and undo

All five items below are implemented and driven end to end against the real
build with both mod layers loaded:

| Step | Remaining | Picked | Creature feats | Label |
|---|---|---|---|---|
| entering the screen | 1 | — | 8 | "1" |
| Select on a highlighted feat | 0 | `[3]` | 9 | "0" |
| Select again (undo) | 1 | — | 8 | "1" |
| Recommended | 0 | `[3]` | 9 | "0" |

- **Picks are tracked** in `selectedFeatIds`, and the allowance comes from
  `featgain.2da` through `CreatureClass.featGainPoints`.
- **Clicking a row highlights it**, reported through the same channel as hover,
  so the description panel and the Select button can never be looking at
  different feats.
- **Eligibility reuses the list-building rules** — `isFeatAvailable`,
  `getFeatStatus`, and the prerequisite pair — rather than re-deriving them, so
  the grid and the button cannot disagree about what is takeable.
- **Select toggles.** Retail has no separate Remove control, so a pick made
  here can be taken back before Accept. Feats granted by class are not in
  `selectedFeatIds` and so cannot be removed — they were never picks.
- **Recommended** spends the remaining allowance on the first eligible feats in
  rule order, stopping when the allowance is gone, mirroring the shape of
  `allocateRecommendedCharGenSkills`.
- `ModuleCreature.removeFeat` was added as the counterpart to `addFeat`; there
  was previously no way to undo one.

### Original remaining-work list, retained for reference

1. **Track picks.** `selectedFeatIds` exists and is always empty. `BTN_SELECT`
   should add the highlighted feat when `getRemainingFeatSelections() > 0`,
   refuse otherwise, and call `updateRemainingSelections()`.
2. **Highlight state.** The list needs a notion of the currently selected row
   so Select and the description panel act on the same feat. `GUIFeatItem`
   already reports its feat on hover; a click path can reuse it.
3. **Respect prerequisites.** `buildFeatList` already computes `status` and
   prerequisite chains via `mainClass.isFeatAvailable` / `getFeatStatus`;
   selection must honour the same rules rather than re-deriving them.
4. **`BTN_RECOMMENDED`.** `CharGenManager` has
   `allocateRecommendedCharGenSkills` for skills — the feat equivalent should
   follow that shape so both screens recommend the same way.
5. **Undo.** Retail lets a pick be taken back before Accept. Picks are tracked
   in `selectedFeatIds`, so removal is symmetric with addition.

## Verification

The chargen screens are only reachable through several menus, so the probes
under `tools/vr-emulator/` drive them: `probe-feats.js` (feats screen, console,
routing diagnostics, screenshot) and `probe-hitbox.js` / `probe-clicksweep.js`
(control geometry and which screen pixels actually fire). `vr:check` does not
visit chargen at all, which is why none of this was caught by the gate.
