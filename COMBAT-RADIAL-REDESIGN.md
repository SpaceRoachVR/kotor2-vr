# Combat radial redesign (ROADMAP 4.8)

**Status:** design agreed 2026-08-23. Not implemented. Supersedes the combat
half of 4.1.

Session 2 of the headset testing recorded "combat actions on the radial were a
mistake and need a different route — a design conversation, not a fix." This is
that conversation's outcome.

## What was actually wrong

Not the radial. `references/vr-design.md` locks "one all-purpose action wheel",
and that decision stands. What was wrong is that `buildVRActionWheel` prepends
`targetActions` and `selfActions` — raw `ActionMenuManager` panels — flat at the
top level, as siblings of Journal and Options. Three consequences:

1. **Depth-one flat dump.** Force Lightning sat next to Messages.
2. **Guaranteed pagination.** Three static screens + a five-item Screens submenu
   + Party + Level-Up + Clear Actions is already at the six-item content cap
   before a single combat action is added. Paging through wedges mid-fight.
3. **Stale target.** `createActionWheel(aimedTargetId)` captures the target when
   the wheel opens, and the wheel is world-fixed while held, so you cannot
   re-aim. A target power aims where you pointed a second ago.

## The insight that reshapes it

Two things the engine already does, which the wheel was ignoring.

**`ActionMenuManager.UpdateActionMenus` already filters situationally.**
Target panel 0 is Attack plus attack-mode feats, filtered by
`getEquippedWeaponType()` — 1 (melee) pulls feat category `0x1104`, 4 (ranged)
pulls `0x1111` — and further filtered along the successor chain so only your
highest rank shows. Target panel 1 is hostile powers (`forcehostile` numeric in
spells.2da). Self panel 1 is friendly powers (`forcefriendly`). Passive feats are
excluded automatically by the category filter. The target block only populates
at all when the target is a hostile creature.

So "show only what is usable in this situation" is not new work. It is already
computed, and was being flattened away.

**`InGameOverlay` is one menu with a tab bar, not eight destinations.**
TSL's overlay declares `BTN_MSG`, `BTN_JOU`, `BTN_MAP`, `BTN_OPT`, `BTN_CHAR`,
`BTN_ABI`, `BTN_INV`, `BTN_EQU`. The wheel was spending three top-level wedges
(Inventory, Character, Map) plus a five-item Screens submenu — eight wedges
across two levels — on a menu that has its own tab bar. That collapses to **one
wedge**.

## The design

### Top-level wheel

Exactly six content items, so it fits one page with no pagination:

| Wedge | Content | Condition |
|---|---|---|
| Attacks | Target panel 0 — Attack + equipped-weapon attack-mode feats | Hostile creature aimed at |
| Force Powers | Hostile panel 1 merged with friendly self panel 1 | Any power known |
| Menu | Opens `InGameOverlay` on the **Character** tab (`BTN_CHAR`); the player uses the menu's own tab bar from there | Always |
| Party | Existing nested party wheel — stays on the wheel because it is used mid-fight | Switchable members exist |
| Comfort Settings | VR-only, so it has no menu-tab home | Always |
| Clear Actions | `BTN_CLEARALL` | Queue non-empty or in combat |

Non-combat world target actions (Security, Bash, mine Disarm/Recover) continue to
appear when a valid non-creature target is aimed at. They are mutually exclusive
with Attacks, because `ActionMenuManager` builds target panels for whichever
single `oTarget` is current — so the combat worst case is exactly the six above.

### Navigation

Attacks and Force Powers are **ordinary submenu wedges**, not tabs. Point,
confirm, the page replaces the wheel — the existing `openSubmenu` behaviour. No
tab strip, no new geometry, no controller rework.

`buildMenu()` is called lazily at the moment the submenu opens, so a combat page
re-snapshots `ActionMenuManager` then rather than when the wheel first opened.

### Attack modes — persistent stance, round-queued

Selecting Flurry does **not** queue one Flurry attack the way the flat game does.
It sets a persistent stance. The stance can be changed between attack rounds,
mirroring the 2D queue system, and a change applies to the **next** round, not
the one in progress.

This composes with the locked swing governor (option c): the stance changes what
a rolling swing rolls *as*; an off-tempo swing still animates and still does
nothing mechanically.

### Stance readout — on the weapon

Beside the diegetic round timer, on whatever is held. Sabers use the hilt. Blasters
use the same place on the blaster body, and the round timer moves there too.
Consistent rule: **the timer and the stance belong to the weapon in your hand**,
whatever it is.

### Target — frozen at open, shown clearly

The target is captured when the wheel opens and is displayed via the engine's own
name plate and health bar, through the existing `setVRSelectedObject` /
`CursorManager` hook. Not re-resolved at activation: the wheel is world-fixed and
your hand is pointing at the *wheel* when you confirm, so a live re-read would
resolve against the menu, not an enemy.

> **SUPERSEDED 2026-08-23 — this decision no longer has a surface.**
>
> The persistent-2D-UI defect was diagnosed the same day and its resolution was
> to stop presenting `InGameOverlay` in VR entirely
> (`INGAME_OVERLAY_PANEL_ENABLED = false`), because the panel world-locked on
> first placement while the overlay laid its target UI out in screen space.
>
> The name plate and health bar live in that overlay. With it unpresented, the
> route chosen here does not exist. **How the frozen target is shown is reopened
> and must be decided before 4.8 is implemented.** The remaining candidates are
> a world-space highlight on the creature, a readout in the wheel's centre hub,
> or both. Everything else in this document stands.

## Hard constraints from the code

These throw `RangeError` rather than degrading, so an overflow means **no wheel at
all**, mid-fight:

- `paginateVRRadialItems` — `contentPerPage` must be 1..6.
- `validateVRRadialMenu` — at most 6 content items and 8 total entries per page
  (6 content + Previous + Next), sequential page indices, nav entries exactly
  where expected.
- `createVRRadialSectors` / `validateCount` — 1..8 entries.

Every combat page must therefore go through `paginateVRRadialItems`. A player deep
in the game with more than six known hostile powers will paginate, and that must
work rather than throw.

### Why filtering is worth more than one saved hop

Sectors are `360/N − 2°` gap, hit-tested by `atan2` against sector half-width,
with the tight case at the inner radius (0.105 m):

| Entries | Wedge | Arc at inner radius | ≈ wrist rotation at 0.6 m reach |
|---|---|---|---|
| 8 (full page + both nav) | 43° | 7.9 cm | ~7.5° |
| 6 | 58° | 10.6 cm | ~10° |
| 3 (a Peragus Attacks page) | 118° | 21.6 cm | ~20° |
| 2 | 178° | 32.6 cm | ~30° |

Hand tremor in an outstretched VR pose is roughly 0.5–1°; tracking jitter
0.1–0.3°. A filtered combat page gives roughly **2.7× the angular error margin**
of a full one. Past that width you stop aiming and start flicking in a direction,
which is what makes a repeated combat action muscle memory. That is the return on
the extra hop.

## Known gap this does not close

`ActionMenuManager` filters by category and known-ness, **not by usability right
now**. There is no Force-point affordability check, no range check, no
already-applied check. On Peragus this is invisible — the Exile knows almost
nothing — but "available in this situation" is a weaker guarantee later in the
game. Revisit before Phase 7, not before Phase 6.

## Also unresolved: no back-navigation

`VRRadialMenuController.openSubmenu` destructively replaces `this.menu` and resets
`pageIndex` to 0. There is no parent stack — `parent`, `back`, `stack`, `rootMenu`
appear nowhere in the controller or the model. Entering a submenu and wanting the
top level means releasing the button and reopening.

Accepted for now: this design makes combat pages one hop deep, so the cost is
small. If it bites in a headset session, the fix is a menu stack plus a Back
entry, which would help Party too.

## Test impact

- **D9–D14** (Screens → Equipment/Abilities/Journal/Messages/Options as separate
  wheel routes) stop being wheel routes. They become tabs inside the one Menu
  route, and should be re-scoped to a single check.
- **D15** (wrong wheel icons) shrinks — most of those wedges cease to exist.
- **D1–D3** (wheel → Inventory / Character / Map) likewise collapse into the Menu
  route.
- **F-section** gains checks for stance persistence across rounds, the
  next-round-not-this-round rule, and the weapon-mounted stance readout on both a
  saber and a blaster.
