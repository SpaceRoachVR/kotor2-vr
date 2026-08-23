# KOTOR II: what the game is supposed to do

The purpose of this file is triage. Most reports on this project are ambiguous
between *our* bug, *vanilla* behaviour, and *a known vanilla quirk*. Knowing what
retail TSL does saves the wrong fix.

**Read this for structure and mechanics, never for numbers.** Every concrete
value — a DC, an XP award, a skill rank, a StrRef — lives in the game data.
Check the `2DA`, the object's GFF, or `dialog.tlk` rather than trusting recall,
including the recall in this file.

## The game

*Star Wars: Knights of the Old Republic II — The Sith Lords* (Obsidian, 2004),
built on Odyssey, itself a fork of BioWare's Aurora. It is a d20-derived RPG:
the player is the Exile, a Jedi cut off from the Force, and the story is about
regaining it while a small cast pulls the character toward light or dark.

TSL shipped incomplete. The final act was cut down, and content that exists in
the game files is unreachable in normal play. **Unreachable content in the data
is not evidence of a loading bug** — see below.

## Module naming, and the shape of a playthrough

Module resrefs are `<number><PLANET>`, and the number groups related areas. The
82 module names in the retail install:

| Prefix | Location | Notes |
|---|---|---|
| `EBO` | Ebon Hawk | `001EBO`–`007EBO`. The hub ship. `001EBO` is the prologue interior |
| `PER` | Peragus Mining Facility | `101PER`–`107PER`. The opening |
| `HAR` | Harbinger | `151HAR`–`154HAR`. Boarded from Peragus |
| `TEL` | Telos / Citadel Station | `201`–`262TEL`. Includes the surface and the Academy |
| `NAR` | Nar Shaddaa | `301`–`371NAR` |
| `DXN` | Dxun | `401`–`421DXN` |
| `OND` | Onderon | `501`–`512OND`. Interleaved with Dxun |
| `DAN` | Dantooine | `601`–`650DAN` |
| `KOR` | Korriban | `701`–`711KOR` |
| `NIH` | Ravager | `851`–`853NIH` |
| `MAL` | Malachor V | `901`–`907MAL`. The finale |
| `COR` | Coruscant | `950COR` — cut content, not reachable in normal play |

Broad flow: prologue on Peragus, then Telos, then several planets in a largely
free order (Nar Shaddaa, Dxun/Onderon, Dantooine, Korriban), then the Ravager
and Malachor V.

## The prologue, because it is our test bed

Acceptance testing runs on Peragus and `001EBO`, so this section matters more
than the rest.

The game opens with the Exile unconscious. **The player first controls T3-M4**, a
utility droid, aboard the Ebon Hawk — which is why a save taken at the start has
a party of one, a Mining Laser equipped, and a Droid Hide in the hide slot.
That is correct, not a save-loading defect.

Consequences for testing that have already caused false reports:

- **The journal is legitimately empty at the start.** No quest has been granted
  yet. A blank active-quest list there is correct.
- **The party is one member.** Party-switch UI having nothing to switch to is
  correct at that point.
- **Droid restrictions apply.** T3-M4 cannot use most equipment, has no Force
  powers, and has droid-only item slots. A "cannot equip" refusal is the rule,
  not a bug.

Later the Exile wakes in the Peragus medical bay, meets Kreia, and picks up
Atton Rand. Peragus is largely deserted, with mining droids as the hostiles.

## The rules layer

TSL is d20: **d20 + ability modifier + ranks against a DC.** Combat is
round-based underneath and real-time on the surface, with attack rolls, armour
class, damage rolls, saving throws, and feats.

**Security** opens locks. This engine resolves it as
`d20 + (Wisdom / 2) + securitySkill > OpenLockDC` — see
`src/engine/interaction/ObjectLockRules.ts`. Note the strict `>`.

### Odyssey lock and destruction flags — read these carefully

These are the flags most often misread, and misreading them has already produced
real bugs in this project:

| Flag | What it actually means |
|---|---|
| `Locked` | The object is locked right now |
| `OpenLockDC` | The DC to pick it. Expresses pickability together with `Locked` |
| `KeyRequired` | Only the authored key opens it. Story-reserved; Security cannot |
| `Lockable` | **"Can be re-locked"** — *not* "can be picked" |
| `Plot` | **Indestructible, not unusable.** Flatscreen opens plot-flagged containers and consoles normally |
| `Min1HP` | Cannot be reduced below 1 HP; effectively unbashable |
| `NotBlastable` | Cannot be bashed |

`Lockable` was previously treated as a pickability gate, which removed Security
from every lock in `001EBO` — including three doors named "Low Security Door"
shipping `Locked=1, KeyRequired=0, OpenLockDC=21` against an actor with Security
6. Unmistakably authored to be picked, yet offering only Bash. Gating on `Plot`
made the same class of mistake and refused the prologue's own tutorial objects.

Rule of thumb: **`KeyRequired` is the story gate. Everything else is a
mechanic.** A locked door that does not require a key is something the player is
allowed to try.

## Systems TSL added over KOTOR 1

Worth knowing because they are the parts most likely to be stubbed here:

- **Influence.** Companions gain and lose influence with the Exile through
  dialogue and actions. High influence unlocks conversations and lets several
  companions be trained as Jedi. This drives a lot of dialogue state.
- **Prestige classes.** Mid-game the Exile takes a light- or dark-side prestige
  class.
- **Item upgrades.** A workbench upgrades weapons and armour; a lab station
  breaks down and creates chemicals. Components and chemicals are separate
  currencies from credits.
- **Mines and demolitions.** Laying, recovering, disarming and examining mines
  are all distinct actions, each with its own class in `src/actions/`.
- **Force alignment affects cost.** Powers cost more when they oppose the
  character's alignment.

## Vanilla behaviour that looks like a bug

- **Missing `.mod` files.** Modules ship as `<name>.rim` plus `<name>_s.rim`.
  Only mod-tool-edited modules exist as `.mod`. An `ENOENT` on
  `modules\001ebo.mod` followed by a successful RIM load is normal.
- **2DA padding rows.** Tables carry blank rows. `planetary.2da` has 16 rows, 12
  real. Warnings about blank entries are padding, not corruption.
- **Cut content in the data.** `950COR` and various unused items and dialogue
  exist in the files but are unreachable. Finding them is not a bug.
- **The Peragus prologue is deliberately sparse.** Empty rooms and an empty
  journal are authored.
- **TSL is famously buggy in retail.** Before deep-diving a strange scripted
  beat, consider whether vanilla does the same thing.

## The K1/K2 split in this codebase

`game/kotor/` implements K1 menus; `game/tsl/` implements K2 and frequently
`extends` the K1 class. A known pattern here is a TSL menu calling
`super.menuControlInitializer(true)`, which **skips the parent's listener
registration** — the menu builds and renders, but its buttons do nothing. That is
not a stub in any obvious sense; the file can look complete, which is exactly why
an earlier audit wrongly concluded no TSL menu was stubbed.

When a TSL feature is dead, diff it against the K1 file before concluding the
logic was never written. A ledger of the remaining dropped handlers lives in
`src/tests/tsl-menu-dropped-handlers.test.ts`.

## Where ground truth actually lives

| Question | Look at |
|---|---|
| What does this object do, and what are its flags? | Its GFF template (`.utp`, `.utd`, `.utc`, `.uti`) |
| What are the rules values? | The relevant `.2da` |
| What does this string say? | `dialog.tlk`, by StrRef |
| What happens in this conversation? | The module's `.dlg`, and its `_dlg.erf` |
| What is scripted here? | The `.ncs` bytecode, and `nwscript/` for opcode semantics |
| What is in this module? | `.are` (static), `.git` (instances), `.ifo` (module info) |

For live state, the emulator harness reads the running game directly — see
`references/vr-testing.md`. That is nearly always faster and more reliable than
reasoning about what the data probably says.
