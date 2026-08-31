# KotOR.js
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-323330?style=for-the-badge&logo=javascript&logoColor=F7DF1E)
![THREE JS](https://img.shields.io/badge/ThreeJs-black?style=for-the-badge&logo=three.js&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-2B2E3A?style=for-the-badge&logo=electron&logoColor=9FEAF9)
![Node JS](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![NPM](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![Webpack](https://img.shields.io/badge/Webpack-8DD6F9?style=for-the-badge&logo=Webpack&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

![KotOR.js](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/src/assets/icons/icon.png)

**A remake of the Odyssey Game Engine that powered KotOR I &amp; II written in JS (TypeScript)**

KotOR.js is a TypeScript-based reimplementation of the Odyssey Game Engine that powered the original Star Wars: Knights of the Old Republic (KotOR) and its sequel, KotOR II: The Sith Lords (TSL). The project aims to support the complete feature set of the original engine. While still in the early stages of development, many systems are already online in some form or fashion.

In addition to the game engine, the project includes an early attempt at a modding suite called KotOR Forge. 

## Technologies
- The code has been re-written in TypeScript and compiles down into JavaScript. 
- THREE.js is used for the base of the rendering engine. 
- Electron is used to package and publish a desktop application. 

[Discussion Thread](https://deadlystream.com/topic/6608-wip-kotor-js-a-game-engine-for-k1-k2-written-in-javascript/)  
[KotOR.js Youtube Channel](https://www.youtube.com/channel/UC7b4RL2mj0WJ7fEvbJePDbA)

[![OpenKotOR Discord](https://discordapp.com/api/guilds/739590575359262792/widget.png?style=banner2)](https://discord.gg/cxuF4xRD66)

## Supported Games
The following games are currently supported:
- [x] [Star Wars: Knights of the Old Republic (PC)](https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic)
- [x] [Star Wars: Knights of the Old Republic II The Sith Lords (PC)](https://en.wikipedia.org/wiki/Star_Wars_Knights_of_the_Old_Republic_II:_The_Sith_Lords)

## Requirements
You will need a valid copy of either KotOR I or KotOR II installed on your system if you want to use KotOR.js to interface with the files of either game. No game files are distributed with this project.

## Web Compatibility (NEW)

[Browser Compatibility Table](https://github.com/KobaltBlu/KotOR.js/wiki/Browser-Support)

The recent transition to TypeScript has brought many improvements to the codebase, including Chrome support. When the project is compiled, the contents of the `dist` folder can be uploaded to a web server. The only requirement is that the site must be accessed from behind a valid SSL certificate. Using the latest version of Chrome is recommended.


[![Demo Icon]][Demo Link]

[Demo Link]: https://play.swkotor.net/ 'Online Playable Demo'
[Demo Icon]: https://img.shields.io/badge/Online_Playable_Demo-37a779?style=for-the-badge&logoColor=white&logo=google-chrome

## Getting Started (Developer)

### Prerequisites
1. Download and install [Node.js / npm](https://www.npmjs.com/get-npm).
2. Clone the KotOR.js repository.
3. Install dependencies:

```bash
npm install
```

---

### Running the App

#### Option A — Desktop app (Electron) — most common
This compiles the TypeScript and launches the Electron desktop window. Run this if you just want to play/test the game locally.

```bash
npm run start
```

> **Hot-reload variant:** Watches for TypeScript changes and auto-restarts Electron on save:
> ```bash
> npm run start-watch
> ```

---

#### Option B — Browser / web dev (HMR dev server)
Use this when you're working on the web frontend (Launcher, Game, Forge, Debugger views) and want to open them in Chrome.

**Start the dev server** (builds, serves, and hot-reloads on save):

```bash
npm run dev
```

This runs webpack-dev-server on **http://localhost:8080** with HMR and React Fast Refresh. It compiles five bundles in parallel:
- `KotOR.js` — core engine library
- `dist/launcher/` — game launcher UI
- `dist/game/` — in-browser game client
- `dist/forge/` — KotOR Forge modding tool
- `dist/debugger/` — script debugger

React app code hot-updates without a full page reload. Changes to the engine bundle (`KotOR.js`) trigger a targeted page reload.

| URL | What it is |
|---|---|
| http://localhost:8080 | Redirects to Launcher |
| http://localhost:8080/launcher/ | Game Launcher |
| http://localhost:8080/game/?key=kotor | KotOR I in-browser |
| http://localhost:8080/game/?key=tsl | KotOR II in-browser |
| http://localhost:8080/forge/ | KotOR Forge modding tool |
| http://localhost:8080/debugger/ | Script debugger |

For build-to-disk without a server (CI, quick compiles):

```bash
npm run webpack:dev-watch
```

For the KOTOR II VR browser path, build to `dist` and start the authenticated
loopback asset service instead of exposing the retail directory through the dev
server:

```powershell
npm run webpack:dev
node tools/asset-http/asset-server.js `
  --game "D:\SteamLibrary\steamapps\common\Knights of the Old Republic II" `
  --user "$env:LOCALAPPDATA\Kotor2VR"
```

Open the one-time `/launch?token=...` URL printed by the service in a fresh
Chrome or Edge process. It selects the TSL profile automatically. Retail assets
are read-only; saves, configuration, screenshots, caches, and logs are routed
to the user-data root. Stop the service with `Ctrl+C` when the browser session
ends.

#### Renderer launch options

Three settings are fixed when the renderer is built and so cannot be in-game
options. Append them to the launch URL. The engine logs which values it started
with — check those lines before trusting a measurement.

| Option | Default | Effect |
|---|---|---|
| `gl=webgl2` | `webgl1` | Creates the context at WebGL 2. **Currently broken:** WebGL 2 renders the startup screens flat green (see `tools/vr-emulator/evidence/greenscreen-webgl{1,2}.png`). The loader is not at fault — textures still resolve and decode; they are not drawn. Kept so the fault can be investigated. |
| `depth=linear` | `logarithmic` | Turns off `logarithmicDepthBuffer`. The logarithmic path writes `gl_FragDepthEXT` in every fragment shader, defeating early depth rejection — expensive, and worst on a tile-based headset GPU. Whether ordinary depth has enough precision across the camera's 0.05–15000 range is a question for the headset, not for reasoning: see H7/H8 in `HEADSET-TEST-PLAN.md`. |
| `xrscale=<0.5–2.0>` | `1.0` | Scales the XR framebuffer. Fill rate goes roughly with the square, so `0.8` is about a third less work per eye. Clamped, not rejected, outside the range. |

#### Optional user-supplied texture layers

The asset service can merge one or more external, read-only mod layers into its virtual
`Override` directory. Download and extract mods yourself; the project does not download,
bundle, or redistribute them. Each `--mod` argument names the directory that directly
contains an `Override` folder. Layers are supplied from lowest to highest priority, so the
last layer wins; any external layer always wins over the retail `Override` directory.

For [Ultimate Character Overhaul Redux by ShiningRedHD](https://www.nexusmods.com/kotor2/mods/1060),
download the archive from its author and extract its compressed **TPC** variant to:

```text
%LOCALAPPDATA%\Kotor2VR\mods\01-uco-redux\Override
```

The optional [Vanilla Planets HD by Saul0097](https://www.nexusmods.com/kotor2/mods/1369)
base archive belongs in:

```text
%LOCALAPPDATA%\Kotor2VR\mods\02-vanilla-planets-hd\Override
```

If the retail installation contains TSLRCM, add each author's TSLRCM compatibility
patch to the corresponding layer after its base archive. Do not put a patch, archive,
or any extracted mod files in the retail game directory.

Then launch the browser service with that layer:

```powershell
npm run webpack:dev
node tools/asset-http/asset-server.js `
  --game "D:\SteamLibrary\steamapps\common\Knights of the Old Republic II" `
  --user "$env:LOCALAPPDATA\Kotor2VR" `
  --mod "$env:LOCALAPPDATA\Kotor2VR\mods\01-uco-redux" `
  --mod "$env:LOCALAPPDATA\Kotor2VR\mods\02-vanilla-planets-hd"
```

Use additional `--mod` arguments only for user-supplied packs, in increasing priority order.
The resolver chooses a higher layer before it chooses a format, then prefers `.tpc` over
`.tga` within that same layer. UCO improves character, creature, droid, and equipment
textures; it does not replace world geometry, environmental art, or unrelated GUI assets.
Vanilla Planets HD is intentionally later in this baseline, so it wins for any shared
resource; inspect the resolver's layer diagnostics before adding more packs. Keep every
mod's original credit and permissions with your local install.

---

#### Option C — VS Code launch configurations
If you're using VS Code, press **F5** (Run & Debug) and pick a configuration. VS Code will automatically start the HMR dev server and open Chrome pointed at the right URL:

- **KotOR Launcher** — opens the launcher at localhost:8080
- **KotOR** — opens the KotOR I game client
- **TSL** — opens the KotOR II game client
- **KotOR Forge** — opens the Forge modding tool
- **KotOR Debugger** — opens the script debugger
- **Dev: HMR (Launcher)** — starts the dev server and opens the launcher

> Or run `npm run dev` manually, then open any of the URLs above in Chrome.

---

### Docker

This project can be containerized as a static web app.

Build the image:

```bash
docker build -t kotor-js-web .
```

Run it:

```bash
docker run --rm -p 8080:80 kotor-js-web
```

Then open:

- `http://localhost:8080/` (Launcher)

Notes:

- The Docker image uses a multi-stage build (`node:alpine` -> `nginx:alpine`).
- It runs the same production build as local web output: `npm run webpack:prod`.

---

### Other Commands

| Command | What it does |
|---|---|
| `npm run dev` | HMR dev server on http://localhost:8080 |
| `npm run webpack:dev` | One-shot development build (no watch) |
| `npm run webpack:dev-watch` | Watch-mode development build (no dev server) |
| `npm run webpack:prod` | Production build (minified, no source maps) |
| `npm run electron:compile` | Compile only the Electron main process TypeScript |
| `npm run test` | Run the Jest test suite |
| `npm run typedoc` | Generate API docs into the `wiki/` folder |

## Screenshots

<div align="center">

| **KotOR.js Launcher** | **KotOR - Taris: Undercity** | **KotOR - Dantooine** |
|:-------------------------:|:-------------------------:|:-------------------------:|
| ![KotOR.js Launcher](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/images/screenshots/KotOR-js-Launcher-001.jpg) | ![KotOR - Taris: Undercity](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/images/screenshots/K1-Screen-001.jpg) | ![KotOR - Dantooine](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/images/screenshots/K1-Screen-003.jpg) |
| **KotOR II - TSL: Awaken Scene** | **KotOR II - TSL: Awaken Scene 2** |  |
| ![KotOR II - TSL: Awaken Scene](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/images/screenshots/K2-Screen-001.jpg) | ![KotOR II - TSL: Awaken Scene 2](https://raw.githubusercontent.com/KobaltBlu/KotOR.js/master/images/screenshots/K2-Screen-002.jpg) |

</div>

## Videos

<div align="center">

| **KotOR.js (2023) - In Browser Demo** | **KotOR JS - Combat Animations Progress Jan 2021** | **KotOR Forge - WIP: Lip Sync Editor Jan 2019** |
|:---:|:---:|:---:|
| [![KotOR.js (2023) - In Browser Demo](https://img.youtube.com/vi/ZT_9vKRC1t8/0.jpg)](https://www.youtube.com/watch?v=ZT_9vKRC1t8) | [![KotOR JS - Combat Animations Progress Jan 2021](https://img.youtube.com/vi/4oQ8nj_zO-w/0.jpg)](https://www.youtube.com/watch?v=4oQ8nj_zO-w) | [![KotOR Forge - WIP: Lip Sync Editor Jan 2019](https://img.youtube.com/vi/4s4uTyP5yqA/0.jpg)](https://www.youtube.com/watch?v=4s4uTyP5yqA) 
| **KotOR JS - Lighting & Lipsync Progress Nov 2018** | **KotOR JS : TSL - Gameplay Compilation Sep 2018** | **KotOR JS: The Endar Spire Sep 2018** 
| [![KotOR JS - Lighting & Lipsync Progress Nov 2018](https://img.youtube.com/vi/2SATn5W2sb4/0.jpg)](https://www.youtube.com/watch?v=2SATn5W2sb4) | [![KotOR JS : TSL - Gameplay Compilation Sep 2018](https://img.youtube.com/vi/IpP6BQJ5ZBQ/0.jpg)](https://www.youtube.com/watch?v=IpP6BQJ5ZBQ) | [![KotOR JS: The Endar Spire](https://img.youtube.com/vi/y2UzOH5bcAQ/0.jpg)](https://www.youtube.com/watch?v=y2UzOH5bcAQ)

</div>

## Influences & Credits

Without these people below I couldn't have gotten this far.  
[xoreos](https://xoreos.org/)  
[The KotOR Modding Community](https://deadlystream.com/)   
  
And many many more!

## License

[GPL 3.0 (GNU General Public License)](LICENSE.md)
