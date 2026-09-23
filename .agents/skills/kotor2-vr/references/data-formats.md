# Odyssey data formats and game content

The engine reads the retail KOTOR II install unmodified from
`D:\SteamLibrary\steamapps\common\Knights of the Old Republic II`.

## Container formats

| Format | Contents |
|---|---|
| `.key` / `.bif` | The base asset store. `chitin.key` indexes the BIFs. |
| `.rim` | Read-only resource bundle. Modules ship as `<name>.rim` + `<name>_s.rim`. |
| `.erf` / `.mod` | Bundle formats; `.mod` is a module packaged as one file. |
| `.sav` | A save is an ERF containing the exported module state. |

Module lookup tries `.mod` first, then falls back to the `.rim` pair. A
`ENOENT ... modules\001ebo.mod` in the log followed by a successful RIM load is
**normal for vanilla** — only modules edited by a mod tool exist as `.mod`.

## Resource formats

| Format | What it is |
|---|---|
| GFF | Generic tree container. Backs almost every game object file. |
| `.utc/.utp/.utd/.uti/.utt/.uts/.utw/.ute/.utm` | GFF templates: creature, placeable, door, item, trigger, sound, waypoint, encounter, store |
| `.are` / `.git` / `.ifo` | Area static data / dynamic instances / module info |
| `.dlg` | Conversation tree (GFF) |
| `.2da` | Table of game rules data |
| `.tlk` | `dialog.tlk`, the string table. StrRefs index into it. |
| `.tpc` | Texture (DXT compressed, with an embedded TXI block) |
| `.mdl` / `.mdx` | Model geometry and animation |
| `.wok` / `.pwk` / `.dwk` | Walkmesh: area, placeable, door |
| `.vis` | Room-to-room visibility for culling |
| `.lyt` | Room layout positions |
| `.lip` | Lip-sync data keyed to a VO resref |
| `.ncs` | Compiled NWScript bytecode |

## Things that bite

**2DA padding rows are normal.** `planetary.2da` has 16 rows, 12 with a real
`guitag` and 4 blank. `MenuGalaxyMap: invalid guitag null` ×4 is padding, not a bug.
Before treating a repeated warning as a defect, check whether the count matches a
known number of blank rows.

**TXI is embedded in the TPC** and controls blending, alpha test, env maps and
animation. A texture that loads but looks wrong is often a TXI handling gap rather
than a missing file.

**Placeables can use creature models.** Corpse containers like Kreia's stunt body are
placeables pointing at a creature model, so they do not run creature animations and
render in bind pose. A "T-posed character that is actually a container" is this, and
usually also means its `.pwk` failed to load.

**Item icons are textures.** Inventory and ability icons resolve through the same
`TextureLoader` path as world surfaces, so a texture-resolution bug shows up in the
GUI and the world simultaneously. That shared path is diagnostic: white boxes in
*both* places points at the loader, not at geometry or GUI layout.

## Checking what vanilla should do

We have repeatedly needed to answer "is this the game being wrong, or the engine?"
Options, cheapest first:

1. **Ask the user.** They are playing it and often already know. Do this before
   speculating.
2. **Read the game data.** Open the module's `.dlg` or template and see what the
   content actually specifies. This is authoritative and beats any recollection.
3. **Consult a playthrough.** The user may link a video. Claude cannot watch video —
   say so and ask for the relevant detail in text rather than pretending otherwise.

Do not rely on recalled plot knowledge. A wrong memory of which character appears in a
scene once sent this project down a completely dead investigative path.

## Peragus prologue module list

The first shippable slice. 18 module files, roughly 12 distinct geometry passes.

- `101PER`–`107PER` — Peragus mining facility
- `151HAR`–`154HAR` — Harbinger
- `001EBO`–`007EBO` — Ebon Hawk interior and hull

You play **T3-M4** for the prologue, which is why player-appearance bugs surface
immediately here.

## TSLRCM

Vanilla for the Peragus slice. TSLRCM is required for the full-campaign v1. M4-78 is
out of scope. Do not assume restored-content behavior when checking vanilla.
