# Dock Zero: Last Light — completion checklist

This checklist translates the approved Game Blueprint into testable browser-game outcomes. Do not claim realism or device support beyond what was tested.

## Core modes and combat
- [ ] Launch from the English title screen into offline survival or an offline six-bot free-for-all.
- [ ] Complete eight escalating survival waves; the final exoskeleton fight has three distinct phases and an exposed, targetable weak point.
- [ ] Defeat wolf/boar masked mercenaries, white combat robots, turret robot dogs, and powered-exoskeleton enemies.
- [ ] Make attacks, kills, drops, accuracy bonuses, style progression, stackable between-wave augments, and eight-second infinite-ammo Overdrive legible and responsive.
- [ ] Verify player attack multiplier is 1.25, incoming enemy damage is unchanged, and explosions never cause self-damage.
- [ ] Verify armor starts at 150 and regenerates at 55/sec after one damage-free second, with armor-break and recharge feedback.
- [ ] Provide the assault rifle, rapidly firing shotgun, rocket launcher, grenades and melee. Confirm the rifle optic is real model geometry and the shotgun's iron sight is aligned.
- [ ] Cover blocks enemy and player shots, projectiles and movement; impact and explosion feedback remains readable.

## Setting and presentation
- [ ] Include weathered container stacks, gantry crane, reach-stacker cover, marked wet concrete, controlled puddle reflections, drizzle, harbor cargo ships and cranes, and cinematic sunset lighting.
- [ ] Display a first-person operator with tactical arms and weapon, plus the loaded full-body silhouette and moving shadow.
- [ ] Animate loaded rigged operators/bipeds during gameplay; keep the procedural robot-dog fallback animateable in motion.
- [ ] Keep firing, damage, low health and motion sharp. Use an edge vignette only—no blur, chromatic split or double vision.
- [ ] Supply title/loading art, a custom favicon, impact particles, visible tracers, ejected shells, restrained weapon flashes, debris and layered audio.

## Inputs, HUD and audio lifecycle
- [ ] Validate keyboard/mouse WASD, pointer aim, fire, red-dot ADS, sprint, jump, slide, Q quick-switch, hold-C crouch, reload, grenade, melee, weapon keys, Overdrive and Esc.
- [ ] Validate menu/controller navigation, movement, aim, fire and contextual gamepad buttons; no essential action may be bound to conflicting buttons.
- [ ] Validate landscape mobile stick movement, drag look, fire, ADS, sprint, jump, crouch, reload, grenade, melee, swap and Overdrive.
- [ ] Show responsive health/armor/ammo, style rank, wave/time/score/kills, boss health/phase, bots alive, Overdrive and direct-hit indicators.
- [ ] On pause, freeze gameplay and immediately mute world audio/music but preserve menu sounds; on resume restore the active audio track.
- [ ] On game over, immediately stop the music/ambience/world bus but retain the result sting and menu sounds.
- [ ] Load title/first-wave characters before allowing deployment. Gate later model stages behind intermission/low pressure, report load failures, and offer retry.

## Quality gates
- [ ] Pass strict TypeScript and existing unit tests.
- [ ] Pass the project Three.js build-size/asset checks.
- [ ] Run the title, first-wave and mobile-layout smoke/screenshot suite with no console/network errors.
- [ ] Inspect the bound Webdev Preview desktop and landscape viewport.
- [ ] Verify generated assets against the locked hashes and the production build restores them from managed storage.
- [ ] Save a recorded checkpoint for the exact pushed commit SHA; do not publish without explicit authorization.
