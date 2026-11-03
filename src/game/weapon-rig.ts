import * as THREE from 'three';

export type WeaponId = 'rifle' | 'shotgun' | 'launcher' | 'grenade';
export type WeaponRig = {
  root: THREE.Group;
  equip(id: WeaponId): void;
  fireKick(): void;
  animate(dt: number, moving: number, crouched: boolean, sliding: boolean, aiming: boolean): void;
  muzzleWorld(camera: THREE.Camera): THREE.Vector3;
  shellWorld(camera: THREE.Camera): THREE.Vector3;
};

type WeaponParts = { group: THREE.Group; muzzle: THREE.Object3D; eject: THREE.Object3D; sight?: THREE.Object3D };

const mat = (color: number, roughness = 0.72, metalness = 0.18) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const dark = mat(0x20282b, 0.64, 0.48);
const black = mat(0x111719, 0.56, 0.48);
const polymer = mat(0x343c39, 0.82, 0.08);
const edge = mat(0x626a62, 0.56, 0.52);
const rubber = mat(0x202522, 0.94, 0.02);
const cloth = mat(0x424940, 0.95, 0.02);
const glove = mat(0x242a27, 0.9, 0.02);
const brass = mat(0x987443, 0.48, 0.62);
const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x8bc8d2, roughness: 0.12, metalness: 0.16, transmission: 0.72, transparent: true, opacity: 0.62, side: THREE.DoubleSide });
const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3325, toneMapped: false });

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, name?: string): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  if (name) m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(parent: THREE.Object3D, size: [number, number, number], pos: [number, number, number], material: THREE.Material, bevel = 0): THREE.Mesh {
  const g: THREE.BufferGeometry = bevel > 0 ? new THREE.BoxGeometry(...size) : new THREE.BoxGeometry(...size);
  const m = mesh(g, material, parent);
  m.position.set(...pos);
  return m;
}
function cylinder(parent: THREE.Object3D, rTop: number, rBottom: number, length: number, pos: [number, number, number], material: THREE.Material, radial = 16): THREE.Mesh {
  const m = mesh(new THREE.CylinderGeometry(rTop, rBottom, length, radial), material, parent);
  m.position.set(...pos);
  m.rotation.x = Math.PI / 2;
  return m;
}
function torus(parent: THREE.Object3D, radius: number, tube: number, pos: [number, number, number], material: THREE.Material): THREE.Mesh {
  const m = mesh(new THREE.TorusGeometry(radius, tube, 8, 20), material, parent);
  m.position.set(...pos);
  return m;
}
function rail(parent: THREE.Object3D, length: number, pos: [number, number, number], axis: 'x' | 'y' | 'z' = 'z'): void {
  const m = box(parent, axis === 'x' ? [length, 0.045, 0.065] : axis === 'y' ? [0.065, length, 0.045] : [0.065, 0.045, length], pos, black);
  void m;
  const count = Math.floor(length / 0.13);
  for (let i = 0; i <= count; i++) {
    const offset = -length / 2 + i * length / count;
    const p: [number, number, number] = axis === 'x' ? [pos[0] + offset, pos[1] + 0.03, pos[2]] : axis === 'y' ? [pos[0], pos[1] + offset, pos[2] + 0.03] : [pos[0], pos[1] + 0.03, pos[2] + offset];
    box(parent, axis === 'x' ? [0.028, 0.018, 0.082] : axis === 'y' ? [0.082, 0.028, 0.018] : [0.082, 0.018, 0.028], p, edge);
  }
}
function marker(parent: THREE.Object3D, name: string, pos: [number, number, number]): THREE.Object3D {
  const o = new THREE.Group(); o.name = name; o.position.set(...pos); parent.add(o); return o;
}
function createRifle(): WeaponParts {
  const g = new THREE.Group(); g.name = 'Rifle';
  box(g, [0.28, 0.24, 0.67], [0, 0, -0.03], polymer);
  box(g, [0.285, 0.065, 0.48], [0, 0.148, -0.04], dark);
  box(g, [0.31, 0.085, 0.3], [0, -0.12, -0.08], dark);
  box(g, [0.25, 0.045, 0.38], [0, 0.198, -0.05], black);
  cylinder(g, 0.047, 0.052, 0.72, [0, 0.025, -0.66], dark, 20);
  cylinder(g, 0.065, 0.065, 0.095, [0, 0.025, -1.055], black, 20);
  box(g, [0.31, 0.21, 0.5], [0, 0.015, -0.47], polymer);
  // Ventilation cuts, fasteners and four Picatinny rails.
  for (let z = -0.3; z > -0.72; z -= 0.105) {
    box(g, [0.012, 0.09, 0.048], [0.158, 0.025, z], black);
    box(g, [0.012, 0.09, 0.048], [-0.158, 0.025, z], black);
  }
  rail(g, 0.78, [0, 0.151, -0.48]); rail(g, 0.7, [0, -0.105, -0.48]);
  rail(g, 0.69, [0.165, 0.015, -0.48]); rail(g, 0.69, [-0.165, 0.015, -0.48]);
  // Stock extends rearward (+Z).
  box(g, [0.21, 0.19, 0.36], [0, -0.015, 0.43], polymer);
  box(g, [0.235, 0.24, 0.075], [0, -0.018, 0.63], rubber);
  box(g, [0.07, 0.21, 0.12], [0, 0.025, 0.31], dark);
  // Curved pistol grip and detachable magazine.
  box(g, [0.14, 0.23, 0.14], [0, -0.245, 0.02], black);
  const grip = box(g, [0.14, 0.32, 0.15], [0, -0.42, 0.11], polymer); grip.rotation.x = -0.22;
  for (let y = -0.48; y < -0.29; y += 0.045) box(g, [0.145, 0.014, 0.155], [0, y, 0.11], dark);
  const mag = box(g, [0.18, 0.39, 0.24], [0, -0.39, -0.18], polymer); mag.rotation.x = -0.13;
  box(g, [0.19, 0.045, 0.25], [0, -0.59, -0.2], black);
  box(g, [0.19, 0.08, 0.23], [0, -0.17, -0.18], dark);
  // Reflex optic: real transparent circular lens, optical axis and tiny red emitter.
  box(g, [0.19, 0.12, 0.19], [0, 0.29, -0.12], black);
  cylinder(g, 0.086, 0.086, 0.16, [0, 0.36, -0.12], black, 24);
  const lens = mesh(new THREE.CircleGeometry(0.071, 32), lensMat, g, 'OpticLens');
  lens.position.set(0, 0.36, -0.035); // plane faces rearward, visible to the player
  const lens2 = mesh(new THREE.CircleGeometry(0.071, 32), lensMat, g);
  lens2.position.set(0, 0.36, -0.205); lens2.rotation.y = Math.PI;
  torus(g, 0.076, 0.008, [0, 0.36, -0.035], edge);
  torus(g, 0.076, 0.008, [0, 0.36, -0.205], edge);
  const dot = mesh(new THREE.SphereGeometry(0.008, 8, 6), dotMat, g, 'OpticalEmitter');
  dot.position.set(0, 0.36, -0.12);
  // Rear backup aperture and charging handle.
  box(g, [0.06, 0.13, 0.07], [0, 0.29, 0.19], dark);
  torus(g, 0.031, 0.008, [0, 0.36, 0.19], edge);
  box(g, [0.11, 0.035, 0.09], [0.19, 0.14, 0.02], dark);
  cylinder(g, 0.022, 0.022, 0.1, [0.24, 0.15, 0.02], edge, 10);
  for (const x of [-0.12, 0.12]) for (const z of [-0.2, 0.12]) {
    const screw = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), edge, g);
    screw.position.set(x, 0.126, z); screw.rotation.x = Math.PI / 2;
  }
  const muzzle = marker(g, 'Muzzle', [0, 0.025, -1.11]);
  const eject = marker(g, 'Eject', [0.17, 0.13, -0.025]);
  return { group: g, muzzle, eject, sight: dot };
}
function createShotgun(): WeaponParts {
  const g = new THREE.Group(); g.name = 'Shotgun';
  box(g, [0.27, 0.23, 0.47], [0, 0, 0.035], polymer);
  box(g, [0.31, 0.13, 0.26], [0, -0.015, -0.18], dark);
  cylinder(g, 0.052, 0.055, 0.94, [0, 0.02, -0.76], dark, 20);
  cylinder(g, 0.069, 0.069, 0.11, [0, 0.02, -1.27], black, 20);
  // Under-barrel magazine tube and hand-sliding pump.
  cylinder(g, 0.036, 0.04, 0.8, [0, -0.105, -0.74], black, 16);
  const pump = new THREE.Group(); pump.name = 'Pump'; g.add(pump);
  box(pump, [0.25, 0.17, 0.35], [0, -0.095, -0.64], polymer);
  for (let z = -0.78; z < -0.48; z += 0.045) box(pump, [0.255, 0.015, 0.02], [0, -0.095, z], dark);
  for (let z = -0.84; z < -0.44; z += 0.11) {
    const band = mesh(new THREE.TorusGeometry(0.043, 0.007, 6, 16), edge, g);
    band.rotation.x = Math.PI / 2; band.position.set(0, -0.105, z);
  }
  // Stock, grip and shell carrier.
  box(g, [0.2, 0.2, 0.39], [0, 0.015, 0.42], polymer);
  box(g, [0.23, 0.24, 0.075], [0, 0.015, 0.63], rubber);
  box(g, [0.14, 0.3, 0.14], [0, -0.29, 0.07], rubber);
  for (let i = 0; i < 4; i++) cylinder(g, 0.022, 0.022, 0.17, [0.15, 0.015, 0.0 - i * 0.06], brass, 10);
  box(g, [0.035, 0.13, 0.28], [0.15, 0.015, -0.1], dark);
  // Rear U-notch and front bead align with bore and optic centerline.
  const rearBase = 0.095;
  box(g, [0.11, 0.035, 0.07], [0, rearBase, 0.19], black);
  box(g, [0.025, 0.12, 0.035], [-0.043, rearBase + 0.06, 0.19], edge);
  box(g, [0.025, 0.12, 0.035], [0.043, rearBase + 0.06, 0.19], edge);
  box(g, [0.09, 0.02, 0.035], [0, rearBase + 0.02, 0.19], black); // open U above this low bridge
  box(g, [0.065, 0.055, 0.075], [0, 0.085, -1.13], dark);
  const bead = mesh(new THREE.SphereGeometry(0.018, 12, 8), edge, g, 'FrontBead');
  bead.position.set(0, 0.13, -1.14);
  const muzzle = marker(g, 'Muzzle', [0, 0.02, -1.33]);
  const eject = marker(g, 'Eject', [0.15, 0.07, -0.02]);
  return { group: g, muzzle, eject, sight: bead };
}
function createLauncher(): WeaponParts {
  const g = new THREE.Group(); g.name = 'Launcher';
  cylinder(g, 0.145, 0.155, 1.38, [0, 0.02, -0.45], polymer, 28);
  cylinder(g, 0.165, 0.165, 0.09, [0, 0.02, -1.16], dark, 28);
  torus(g, 0.147, 0.014, [0, 0.02, -1.14], edge);
  cylinder(g, 0.126, 0.126, 0.08, [0, 0.02, 0.24], black, 24);
  box(g, [0.3, 0.09, 0.36], [0, 0.13, 0.27], dark);
  box(g, [0.19, 0.38, 0.18], [0, -0.2, 0.2], polymer);
  box(g, [0.13, 0.23, 0.14], [0, -0.4, 0.22], rubber);
  box(g, [0.22, 0.15, 0.27], [0, -0.13, -0.48], polymer);
  box(g, [0.23, 0.045, 0.72], [0, 0.18, -0.45], black);
  rail(g, 0.66, [0, 0.208, -0.45]);
  // Compact optical tube and protected rear sight.
  box(g, [0.17, 0.12, 0.2], [0, 0.28, -0.2], black);
  cylinder(g, 0.046, 0.046, 0.17, [0, 0.31, -0.2], edge, 16);
  const lens = mesh(new THREE.CircleGeometry(0.036, 24), lensMat, g);
  lens.position.set(0, 0.31, -0.105);
  const lensBack = mesh(new THREE.CircleGeometry(0.036, 24), lensMat, g);
  lensBack.position.set(0, 0.31, -0.295); lensBack.rotation.y = Math.PI;
  const sight = box(g, [0.04, 0.09, 0.06], [0, 0.31, 0.3], edge);
  const muzzle = marker(g, 'Muzzle', [0, 0.02, -1.23]);
  const eject = marker(g, 'Eject', [0.15, 0.12, 0.18]);
  return { group: g, muzzle, eject, sight };
}
function createGrenade(): WeaponParts {
  const g = new THREE.Group(); g.name = 'Grenade';
  const body = mesh(new THREE.SphereGeometry(0.22, 20, 16), polymer, g);
  body.scale.set(0.86, 1.15, 0.82); body.position.set(0, -0.01, -0.22);
  cylinder(g, 0.13, 0.13, 0.24, [0, 0.18, -0.22], dark, 16);
  cylinder(g, 0.105, 0.105, 0.08, [0, 0.32, -0.22], edge, 16);
  for (let y = -0.16; y < 0.14; y += 0.055) {
    const band = mesh(new THREE.TorusGeometry(0.176, 0.018, 6, 20), dark, g);
    band.position.set(0, y, -0.22); band.rotation.x = Math.PI / 2;
  }
  box(g, [0.11, 0.29, 0.12], [0, -0.39, 0.01], rubber);
  box(g, [0.08, 0.29, 0.035], [0, -0.38, 0.075], edge);
  // Safety lever and pull ring.
  const lever = box(g, [0.06, 0.39, 0.035], [0.16, 0.08, -0.19], edge); lever.rotation.z = -0.14;
  torus(g, 0.07, 0.012, [0.16, 0.34, -0.21], edge);
  const muzzle = marker(g, 'Muzzle', [0, 0, -0.48]);
  const eject = marker(g, 'Eject', [0.17, 0.11, -0.18]);
  return { group: g, muzzle, eject };
}

function createArm(parent: THREE.Object3D, side: -1 | 1, forward: boolean): void {
  const x = forward ? side * 0.32 : side * 0.43;
  const y = forward ? -0.27 : -0.38;
  const z = forward ? -0.43 : 0.03;
  const arm = new THREE.Group(); arm.name = side < 0 ? (forward ? 'LeftSupportArm' : 'LeftArm') : (forward ? 'RightSupportArm' : 'RightArm');
  arm.position.set(x, y, z); parent.add(arm);
  // Sleeve/forearm tapered segments converge on the weapon grip.
  const upper = mesh(new THREE.CapsuleGeometry(0.115, 0.46, 5, 10), cloth, arm);
  upper.rotation.x = Math.PI / 2 + (forward ? -0.15 : 0.15);
  upper.rotation.z = side * -0.18;
  upper.position.set(side * -0.045, 0, 0.25);
  const cuff = mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.12, 12), dark, arm);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(0, 0, 0.01);
  const wrist = mesh(new THREE.CapsuleGeometry(0.082, 0.2, 4, 8), glove, arm);
  wrist.rotation.x = Math.PI / 2; wrist.position.set(0, -0.01, -0.13);
  const palm = mesh(new THREE.BoxGeometry(0.15, 0.12, 0.2), glove, arm);
  palm.position.set(side * 0.012, -0.025, -0.27);
  // Individuated gripping fingers and thumb pads.
  for (let i = 0; i < 4; i++) {
    const finger = mesh(new THREE.CapsuleGeometry(0.025, 0.105, 3, 6), glove, arm);
    finger.rotation.x = Math.PI / 2; finger.rotation.z = side * 0.08;
    finger.position.set((i - 1.5) * 0.035, -0.075, -0.31);
  }
  const thumb = mesh(new THREE.CapsuleGeometry(0.026, 0.12, 3, 6), glove, arm);
  thumb.rotation.x = Math.PI / 2; thumb.rotation.z = side * 0.9;
  thumb.position.set(side * 0.105, 0.005, -0.28);
  // Reinforced knuckle panel.
  const pad = box(arm, [0.11, 0.025, 0.12], [side * 0.02, 0.045, -0.27], dark);
  pad.rotation.x = -0.1;
}

export function createWeaponRig(): WeaponRig {
  const root = new THREE.Group(); root.name = 'FirstPersonWeaponRig';
  const view = new THREE.Group(); view.name = 'WeaponPresentation'; root.add(view);
  const armLayer = new THREE.Group(); armLayer.name = 'Arms'; view.add(armLayer);
  createArm(armLayer, -1, true); createArm(armLayer, 1, false);
  const factories: Record<WeaponId, () => WeaponParts> = { rifle: createRifle, shotgun: createShotgun, launcher: createLauncher, grenade: createGrenade };
  const weapons = new Map<WeaponId, WeaponParts>();
  for (const id of ['rifle', 'shotgun', 'launcher', 'grenade'] as const) {
    const parts = factories[id]();
    // Weapon local axes: front is -Z. Place at comfortable lower-right viewmodel position.
    parts.group.position.set(0.32, -0.28, -0.72);
    parts.group.rotation.set(0.025, 0, -0.035);
    view.add(parts.group); weapons.set(id, parts);
  }
  let activeId: WeaponId = 'rifle';
  for (const [id, parts] of weapons) parts.group.visible = id === activeId;
  let kick = 0;
  let kickVelocity = 0;
  let phase = 0;
  let aimBlend = 0;
  // Subtract the optic's camera-relative offset so the physical sight approaches screen center.
  const aimPosition = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  function equip(id: WeaponId): void {
    activeId = id;
    for (const [key, parts] of weapons) parts.group.visible = key === id;
  }
  function fireKick(): void {
    kickVelocity += 4.8;
  }
  function animate(dt: number, moving: number, crouched: boolean, sliding: boolean, aiming: boolean): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    phase += step * (2.3 + Math.min(Math.abs(moving), 1) * 8);
    const weapon = weapons.get(activeId)!;
    const targetAim = aiming && activeId !== 'grenade' ? 1 : 0;
    aimBlend = THREE.MathUtils.damp(aimBlend, targetAim, 12, step);
    const sight = weapon.sight;
    if (sight) {
      // Sight is positioned on the optical/bore line. Camera child transforms are intentionally
      // kept weapon-local: aiming moves the entire model until that real sight occupies center.
      sight.getWorldPosition(scratch);
      const sightLocal = weapon.group.worldToLocal(scratch.clone());
      aimPosition.set(-sightLocal.x - weapon.group.position.x, -sightLocal.y - weapon.group.position.y, 0);
    }
    const low = (crouched ? 0.035 : 0) + (sliding ? 0.16 : 0);
    const bob = Math.min(Math.abs(moving), 1);
    view.position.set(
      THREE.MathUtils.lerp(Math.sin(phase * 0.5) * 0.008 * bob, 0, aimBlend),
      -low + Math.sin(phase) * 0.006 * (1 - aimBlend),
      -kick
    );
    view.position.x += aimPosition.x * aimBlend;
    view.position.y += aimPosition.y * aimBlend;
    view.position.z += aimPosition.z * aimBlend;
    view.rotation.set(
      0.012 * Math.sin(phase) * (1 - aimBlend) + kick * 0.09,
      Math.sin(phase * 0.5) * 0.012 * bob * (1 - aimBlend),
      -0.018 * bob * Math.cos(phase) * (1 - aimBlend)
    );
    kickVelocity -= kick * 34 * step;
    kickVelocity *= Math.exp(-13 * step);
    kick = Math.max(0, kick + kickVelocity * step);
  }
  function worldPoint(camera: THREE.Camera, markerName: 'Muzzle' | 'Eject'): THREE.Vector3 {
    const parts = weapons.get(activeId)!;
    const marker = parts.group.getObjectByName(markerName);
    if (!marker) return camera.getWorldPosition(new THREE.Vector3());
    root.updateWorldMatrix(true, true);
    marker.getWorldPosition(scratch);
    return scratch.clone();
  }
  return {
    root,
    equip,
    fireKick,
    animate,
    muzzleWorld(camera: THREE.Camera): THREE.Vector3 { void camera; return worldPoint(camera, 'Muzzle'); },
    shellWorld(camera: THREE.Camera): THREE.Vector3 { void camera; return worldPoint(camera, 'Eject'); }
  };
}
