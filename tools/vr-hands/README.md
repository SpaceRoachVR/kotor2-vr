# VR hand models

`generic-hand/left.glb` and `generic-hand/right.glb` are the rigged hand meshes
from [`@webxr-input-profiles/assets`](https://www.npmjs.com/package/@webxr-input-profiles/assets)
**1.0.20** (`dist/profiles/generic-hand/`), copied unmodified. MIT licensed,
copyright 2019 Amazon — see `generic-hand/LICENSE.md`. MIT is compatible with
this project's GPL-3.0, and the notice must ship with any distribution.

Each file is a 25-joint skinned mesh whose joints follow the WebXR Hand Input
naming and axis convention: every joint is a direct child of `Armature` (no
bone hierarchy), local −Z runs along the bone toward the fingertip, +Y points
out of the back of the hand, and a negative rotation about local +X flexes a
finger toward the palm. `VRHandSkeletonPoser` depends on that convention.

## Why the models are embedded rather than served

The runtime does not fetch these files. `embed-generic-hands.js` writes them as
base64 into `src/vr/runtime/hands/GenericHandGLB.generated.ts`, which the
bundle carries. Electron loads the build over `file://`, where any absolute
asset path resolves to the drive root (see the black-window trap in the
workflow reference); embedding sidesteps every public-path and
File System Access problem for the ~190 KB the two hands cost.

After replacing a `.glb`, regenerate:

```
node tools/vr-hands/embed-generic-hands.js
```
