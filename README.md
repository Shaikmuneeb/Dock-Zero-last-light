# Dock Zero: Last Light

A browser-based first-person survival shooter in a rain-swept, sunset-lit container terminal. Play the eight-wave Last Light campaign, ending in a three-phase exoskeleton boss, or enter a free-for-all against six local AI combatants. Both modes are single-player and do not require sign-in; asset delivery may require a first-load network connection.

## Run and verify

```bash
pnpm install
pnpm dev -- --host 0.0.0.0 --port 3000  # local Vite preview
pnpm typecheck                           # strict TypeScript
pnpm test                                # unit tests
pnpm build                               # game-sharing output + Vite build + size check
pnpm smoke                              # after build: Chromium playthrough and screenshots
```

The managed Sandbox preview is started with `PORT=3000 HOST=0.0.0.0 pnpm dev -- --host 0.0.0.0 --port 3000`.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| Left mouse | Fire |
| Right mouse | Aim through the modeled rifle optic / shotgun iron sights |
| `Shift` | Sprint |
| `C` | Crouch; hold with sprint to slide |
| `Space` | Jump |
| `Q` | Quick-switch |
| `1–4` | Rifle, shotgun, rocket launcher, grenade |
| `R` | Reload |
| `G` | Throw a grenade |
| `V` | Melee |
| `X` | Activate Overdrive |
| `Esc` / `P` | Pause and resume |
| Gamepad | Left stick move; right stick aim; triggers fire/aim; face/shoulder/stick buttons for jump, sprint, reload, melee, grenade, swap and Overdrive; Start pauses |
| Landscape touch | Left-side floating movement stick, right-side drag-to-look, on-screen combat buttons |

Mouse play requests pointer lock after the player chooses a mode; if the browser declines it, keyboard, controller and touch play still work.

## Game systems

Player attacks use the requested 1.25× baseline against enemies while hostile damage and self-inflicted explosive damage stay unboosted. Armor starts at 150 and recharges by 55/sec after one damage-free second. Kills award field pickups; accuracy and movement earn style rank; stackable augments appear between waves. Overdrive lasts eight seconds with faster fire and unlimited ammunition. The rifle's red-dot optic and the shotgun's aligned iron sights are physical weapon geometry, not HUD reticles.

## Project structure

- `src/main-fps.ts` starts the FPS and connects input, audio, settings, authentication status, game loop and UI.
- `src/game/fps.ts` owns offline survival/FFA simulation, combat, waves, boss, armor, drops and stage-aware model use.
- `src/game/terminal-world.ts` builds the harbor terminal and cover.
- `src/game/weapon-rig.ts` constructs and animates first-person weapons/arms, including optic and iron sights.
- `src/game/fps-assets.ts` names the registered staged GLB, background and favicon URLs.
- `src/engine/input.ts`, `audio.ts`, and `loop.ts` own unified input, safe audio buses and the fixed-step frame loop.
- `src/ui/fps-ui.ts`, `src/ui/touch.ts`, and `src/styles/main.css` provide the English menus, combat HUD and landscape touch interface.
- `src/game/tuning.ts` is the sole FPS Preview Tweak catalog; its controls are consumed by movement, damage, armor and camera code.
- `assets.lock.json` records registered models and art for CDN-backed, staged loading. Local edits remain in source; use the runtime's save/sync flow for managed checkpoints.

## Audio and offline play

Title, combat and boss music are routed separately from the world and menu sounds. Pause silences music/ambience/world SFX but preserves UI feedback; resume restores the track, and game over stops world audio while retaining the result sting. Account services are optional and do not gate either mode.

## Attribution

The starter's bundled Manus CC0 typefaces are retained under `public/fonts/`. Three.js, Rapier and Web Audio remain the browser runtime components. Generated art and character meshes were created for this project under its approved game-asset workflow.
