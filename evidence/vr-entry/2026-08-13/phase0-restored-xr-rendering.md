# Restored XR framebuffer submission

Date: 2026-08-13

Device path: Quest 3, Virtual Desktop, VDXR, isolated Chrome profile, RTX 3060.

## Device observation

- Peragus rendered in the headset with tracked head motion.
- Keyboard WASD movement worked while presenting in VR.
- Chrome continued to show the ordinary flat desktop view as a mirror.
- VR entry did not trigger the KOTOR pause overlay after DOM input isolation.

## Root cause and correction

Three.js bound its XR render target before invoking the application frame. During that frame, legacy KOTOR GUI texture rendering called `renderer.setRenderTarget(null)`. The final world render therefore completed against the desktop canvas while Chrome reported that nothing was drawn to the XR framebuffer.

`VRSpike` now captures Three.js's XR render target at callback entry and restores it immediately before the world submission. Its DOM Enter/Exit button also isolates pointer and mouse press phases from the legacy GUI input system.

## Captured cadence

Four consecutive one-minute windows after the correction reported trustworthy one-update/one-render XR cadence:

- 65.50 FPS, p90 15.8 ms, p99 16.4 ms, 0.33% over 20 ms.
- 64.27 FPS, p90 15.8 ms, p99 16.3 ms, 0.23% over 20 ms.
- 64.44 FPS, p90 15.8 ms, p99 16.4 ms, 0.10% over 20 ms.
- 64.08 FPS, p90 16.1 ms, p99 17.4 ms, 0.68% over 20 ms.

Heap fell from 1909.6 MB during the first captured window to 729.8 MB after warm-up and then remained at 741.3-741.7 MB in the following two windows.

## Remaining device gates

- Exit and re-enter lifecycle is not yet device-passed.
- Quest controller input is not implemented in the measurement spike.
- Camera/body alignment, roomscale correction, UI, interaction, and combat remain production-foundation work.
- The runtime's exposed `frameRate` reported 50 Hz while measured callbacks were approximately 64-65 FPS; runtime-rate reporting needs separate correction and must not be inferred from this observation.
