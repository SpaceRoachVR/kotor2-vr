# KOTOR II VR

Star Wars: Knights of the Old Republic II: The Sith Lords, in first-person VR.

Not a flat screen floating in front of your face. You stand on Peragus as the Exile, walk around at your own height, swing a lightsaber with your actual arm, and aim blasters down the barrel. The story, the dialogue, the stats and the dice rolls are all still KOTOR II. You're just inside it now.

**This is a work in progress and it is not ready to play yet.** There's no release, no installer, and a lot is still broken. If you want to follow along or poke at it, read on.

**All the VR work lives on the [`spike/stereo-perf`](https://github.com/SpaceRoachVR/kotor2-vr/tree/spike/stereo-perf) branch, so clone or check out that branch (`git clone -b spike/stereo-perf https://github.com/SpaceRoachVR/kotor2-vr.git`). `master` doesn't have the VR code yet.**

## Built on KotOR.js by KobaltBlu

This whole project is a fork of [KotOR.js](https://github.com/KobaltBlu/KotOR.js) by [KobaltBlu](https://github.com/KobaltBlu). KotOR.js is a rebuild of the Odyssey engine (the engine behind KOTOR 1 and 2) written from scratch in TypeScript. It reads your own game files and runs the game in a browser or desktop app.

None of this VR stuff would exist without it. KobaltBlu spent years getting that engine to the point where you can load TSL and actually play it, and every hour of VR work here is sitting on top of that. Seriously, go check out the original project, the [online demo](https://play.swkotor.net/), the [Deadly Stream thread](https://deadlystream.com/topic/6608-wip-kotor-js-a-game-engine-for-k1-k2-written-in-javascript/) and the [KotOR.js YouTube channel](https://www.youtube.com/channel/UC7b4RL2mj0WJ7fEvbJePDbA).

A lot of what I've fixed along the way isn't VR at all. It's plain engine bugs (merchants that never loaded, save files dropping data, script functions that weren't implemented yet). The plan is to offer those fixes back to KotOR.js once the VR project is done and I can show they actually help. I also keep pulling in KobaltBlu's updates so we're not fixing the same bugs twice.

## You bring the game

No game files are included here, and none ever will be. You need your own copy of KOTOR II. I use the Steam version on PC. The mod reads your install and never writes to it. Saves, settings and logs go to their own folder (`%LOCALAPPDATA%\Kotor2VR`), so your normal game stays exactly how it was.

## What works right now

Everything below is built and has been through real headset testing, but "built" doesn't mean "done." I've been doing numbered test rounds in the headset (13 so far), and every round turns up new stuff.

**Getting around**
- Smooth locomotion and smooth turning by default. Snap turn, teleport and a comfort vignette are there if you want them.
- Roomscale by default, seated works too.
- Walk into a wall and it gently pushes you back instead of letting you clip through.
- Comfort settings you can change from inside the headset.

**Combat**
- It's still the KOTOR d20 system under the hood. Your stats decide whether you hit and how hard. Your swing decides *when* you attack. No swing, no attack.
- The swing has to actually reach the enemy to count. Swing a little early and it'll queue up for the next round instead of doing nothing.
- One-handed and two-handed lightsaber grips. Grab with your off hand for two-handed.
- Blasters aim wherever the barrel points, with a laser sight. Pull the trigger to fire.
- Force push and pull are hand flicks.
- A timer in the lightsaber hilt shows when your next attack round is ready.
- Haptics for your own rolls and for getting hit, including which side it came from.
- An optional pause you can call up to plan a fight. It never kicks in on its own.
- Swing at a locked door or container to bash it open.
- Party members fight on their own when they're in range, but any orders you gave them come first.

**Menus and interacting**
- Hold X for an action wheel. Inventory, character sheet, map, party orders, comfort settings and everything else live there.
- Walk up to a door, container, mine or console and the options pop up right there. No more getting dragged across the room to use something.
- The regular game menus float in front of you as panels.

**Story stuff**
- Dialogue happens in the world with the characters, with the text in the lower half of your view.
- Cutscenes from places you can't see (security cameras, other rooms, logs) and the pre-rendered movies play on a big theater screen instead of yanking your head around.
- Fades between camera cuts so it doesn't make you sick.

**Performance**
- The target is a steady 50 FPS or better on an RTX 3060 streaming to a Quest 3 over Virtual Desktop. It's hitting that now. 72 FPS is the stretch goal.

## What's still broken or missing

Being straight with y'all, this list is long.

- **You can't play the whole game yet.** Peragus (the mining station prologue) is where all the testing happens. I've got an automated run that goes almost all the way through it, but a clean start-to-finish run in the headset hasn't happened yet.
- **Swoop racing is broken in VR.** A bunch of fixes looked good in testing and then didn't hold up in the headset.
- **Around 40 of the game's script functions still aren't implemented.** Most are rare, but a few matter, like the dueling ring rules and some mines that get placed by scripts.
- **No physical inventory yet.** The inventory is a floating menu for now.
- **Memory creeps up** the more areas you load. Long sessions can get sluggish.
- **The galaxy map** needs another look.
- **Geometry fixes.** Some spots were built for a camera floating behind your shoulder, not for someone standing in them. Those need to be fixed area by area.
- WebGL 2 mode renders a green screen. Stick with the default.

## Where it's headed

Roughly in this order:

1. **Peragus fully playable in VR.** That's the first real release. The goal is that someone who isn't me can put on a headset and play through the prologue.
2. **The full campaign.** Start to finish, every planet. No cutting it down to a demo.
3. **TSLRCM support**, since most people play with the Restored Content Mod anyway.
4. **Optional HD texture packs.** Old textures look way rougher when your face is 6 inches from a wall. You'll always download these yourself from the mod authors.
5. **A proper install.** Right now running it takes developer tools. That needs to go away before release.
6. **Maybe a native Quest 3 version** down the road. For now it's PC VR streamed to the headset.
7. **Sending engine fixes back to KotOR.js** once it's all done.

M4-78 is out of scope.

The day-to-day plan with all the details lives in [ROADMAP.md](ROADMAP.md), and the design reasoning is in [DESIGN.md](DESIGN.md).

## Trying it yourself (for the brave)

Heads up, this is still a developer setup, not a mod install. You need a Windows PC, Chrome or Edge, and a headset connected with Virtual Desktop using its VDXR runtime (SteamVR doesn't need to be running). The Electron desktop app can't do VR, so VR runs in the browser.

1. Install [Node.js](https://nodejs.org/).
2. Clone this repo and install everything:

   ```bash
   npm install
   ```

3. Build it:

   ```bash
   npm run webpack:dev
   ```

4. Start Virtual Desktop with VDXR selected, then launch:

   ```bash
   npm run vr:play
   ```

That starts a small local server that reads your game files and opens a fresh browser window pointed at it. Hit Enter VR once it's loaded.

Right now `vr:play` expects the game at `D:\SteamLibrary\steamapps\common\Knights of the Old Republic II` because that's where mine is. If yours lives somewhere else, start the server yourself and open the link it prints in a fresh Chrome or Edge window:

```bash
node tools/asset-http/asset-server.js --game "C:\path\to\Knights of the Old Republic II"
```

**Don't use `npm run dev` with the desktop app.** It breaks the file paths and you'll just get a black window.

### Texture mods

You can layer texture mods on top without touching your game folder. Drop each one in its own numbered folder under `%LOCALAPPDATA%\Kotor2VR\mods\`, each with an `Override` folder inside. Higher numbers win. What I've been testing with:

- `01-uco-redux` for [Ultimate Character Overhaul Redux](https://www.nexusmods.com/kotor2/mods/1060) by ShiningRedHD (grab the TPC version)
- `02-vanilla-planets-hd` for [Vanilla Planets HD](https://www.nexusmods.com/kotor2/mods/1369) by Saul0097
- `03-tslrcm` for [TSLRCM](https://steamcommunity.com/sharedfiles/filedetails/?id=485537937) from the Steam Workshop

Download them from their authors yourself. Nothing here bundles or re-uploads anybody's mod.

### KotOR.js stuff

All the regular KotOR.js tools (the launcher, KOTOR 1 support, KotOR Forge, the script debugger) are still in here. For how those work, check the [original KotOR.js README](https://github.com/KobaltBlu/KotOR.js#readme).

## Credits

- **[KobaltBlu](https://github.com/KobaltBlu)** for [KotOR.js](https://github.com/KobaltBlu/KotOR.js), the engine this whole thing runs on.
- **[xoreos](https://xoreos.org/)** and **[reone](https://github.com/seedhartha/reone)**, other open Odyssey engine projects. KotOR.js leans on xoreos, and reone has been my go-to reference for how things should render.
- **[PyKotor](https://github.com/NickHugi/PyKotor)**, used to check this build against the real game's files.
- **The [Deadly Stream](https://deadlystream.com/) modding community**, whose tools and years of documentation make any of this possible.
- **[StrategyWiki](https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic_II:_The_Sith_Lords)**, for the combat rules tables I keep checking against.
- **ShiningRedHD** (UCO Redux), **Saul0097** (Vanilla Planets HD) and **the TSLRCM team** for the mods I test with.
- **Meta's [WebXR input profiles](https://github.com/immersive-web/webxr-input-profiles)** for the hand models, and **[IWER](https://github.com/meta-quest/immersive-web-emulation-runtime)** for testing without a headset on.
- **Obsidian Entertainment** for making KOTOR II in the first place.

Star Wars and Knights of the Old Republic belong to Lucasfilm and Disney. This is a free fan project and isn't affiliated with or endorsed by them, Obsidian, BioWare or Aspyr.

## License

[GPL 3.0](LICENSE.md), same as KotOR.js. The source stays open.
