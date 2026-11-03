import * as THREE from 'three'

export type SolidRect = { minX: number; maxX: number; minZ: number; maxZ: number; height: number }
export type TerminalWorld = {
  group: THREE.Group
  solids: SolidRect[]
  spawn: THREE.Vector3
  update(dt: number, focus: THREE.Vector3, active: boolean): void
}

const mat = (color: string, roughness = 0.78, metalness = 0.08) => new THREE.MeshStandardMaterial({ color, roughness, metalness })
const concrete = mat('#4c555b', 0.92)
const dark = mat('#26343a')
const steel = mat('#536168', 0.55, 0.55)
const warmSteel = mat('#a45b3f', 0.68, 0.28)
const cream = mat('#d2b990', 0.72, 0.15)
const containerMats = ['#9b493d', '#b26a42', '#496b73', '#596b55', '#6b5968', '#ba8b53'].map(c => mat(c, 0.82, 0.18))
const boxGeo = new THREE.BoxGeometry(1, 1, 1)
const cylinderGeo = new THREE.CylinderGeometry(1, 1, 1, 12)
const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }

export function createTerminalWorld(): TerminalWorld {
  const group = new THREE.Group()
  const solids: SolidRect[] = []
  const random = rng(59173)
  const addBox = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material, cast = true) => {
    const mesh = new THREE.Mesh(boxGeo, material)
    mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = cast; mesh.receiveShadow = true
    group.add(mesh); return mesh
  }
  const addSolid = (x: number, z: number, w: number, d: number, h: number) => solids.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: h })
  const addCylinder = (x: number, y: number, z: number, r: number, h: number, material: THREE.Material, horizontal = false) => {
    const mesh = new THREE.Mesh(cylinderGeo, material); mesh.position.set(x, y, z); mesh.scale.set(r, h, r)
    if (horizontal) mesh.rotation.z = Math.PI / 2
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 110), concrete)
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.12, -19); ground.receiveShadow = true; group.add(ground)

  // Painted lane lines, worn stop bars, and reflective but subdued standing water.
  const paint = new THREE.MeshStandardMaterial({ color: '#c8b78f', roughness: 0.58, metalness: 0.12 })
  for (const x of [-17, 17]) {
    for (let z = 19; z > -42; z -= 5.2) addBox(x, -0.045, z, 0.14, 0.018, 2.35, paint, false)
  }
  for (const z of [15, -9, -31]) {
    for (let i = -3; i <= 3; i++) addBox(i * 2.8, -0.04, z, 1.15, 0.018, 0.18, paint, false)
  }
  const puddleMat = new THREE.MeshStandardMaterial({ color: '#263941', roughness: 0.24, metalness: 0.34, transparent: true, opacity: 0.52 })
  for (const [x, z, rx, rz] of [[-11, 9, 3, 1.1], [12, 2, 2.4, 0.8], [-6, -18, 4.2, 1.1], [10, -35, 3, 0.7], [1, -5, 1.5, 0.5]]) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 28), puddleMat); p.rotation.x = -Math.PI / 2; p.position.set(x, -0.025, z); p.scale.set(rx, rz, 1); group.add(p)
  }

  // Container stacks flank the broad central combat lane. Ribbing, corner castings, doors and markings add scale.
  const addContainer = (x: number, z: number, level: number, colorIndex: number, w = 11.7) => {
    const h = 2.7, d = 5.8, y = h * (level + 0.5)
    addBox(x, y, z, w, h, d, containerMats[colorIndex % containerMats.length]); addSolid(x, z, w, d, y + h / 2)
    const sideColor = colorIndex % 2 ? dark : steel
    for (let i = 0; i <= 12; i++) {
      const xx = x - w / 2 + w * i / 12
      addBox(xx, y, z - d / 2 - 0.025, 0.075, h - 0.13, 0.055, sideColor, false)
      addBox(xx, y, z + d / 2 + 0.025, 0.075, h - 0.13, 0.055, sideColor, false)
    }
    for (const xx of [x - w / 2 + 0.12, x + w / 2 - 0.12]) for (const zz of [z - d / 2 - 0.07, z + d / 2 + 0.07]) {
      addBox(xx, y, zz, 0.21, h - 0.08, 0.18, warmSteel, false)
    }
    // End doors and locking bars face into the lane at selected ends.
    if (colorIndex % 3 === 0) {
      const end = x < 0 ? x + w / 2 + 0.035 : x - w / 2 - 0.035
      for (let j = -2; j <= 2; j++) addBox(end, y, z + j * 0.82, 0.08, h - 0.18, 0.07, steel, false)
      addBox(end, y, z, 0.1, 0.055, d - 0.45, cream, false)
    }
    // Tiny stencilled placard kept as geometry rather than text texture.
    addBox(x - w * 0.25, y + 0.76, z - d / 2 - 0.065, 1.12, 0.34, 0.025, cream, false)
  }
  const stacks: [number, number, number, number, number?][] = [
    [-24, 13, 0, 0], [-24, 13, 1, 3], [-24, -1, 0, 2], [-24, -1, 1, 1], [-24, -15, 0, 4], [-24, -15, 1, 0], [-24, -29, 0, 5],
    [24, 15, 0, 1], [24, 15, 1, 4], [24, 1, 0, 0], [24, 1, 1, 2], [24, -13, 0, 3], [24, -13, 1, 5], [24, -27, 0, 2],
    [-37, 3, 0, 3, 10], [-37, -10, 0, 5, 10], [37, 8, 0, 0, 10], [37, -6, 0, 4, 10],
  ]
  for (const [x, z, level, ci, width] of stacks) addContainer(x, z, level, ci, width ?? 11.7)

  // Reach-stacker cover: articulated-looking chassis, cab, rubber wheels, counterweight and raised spreader boom.
  const rx = -11.1, rz = -10.3
  addBox(rx, 0.95, rz, 6.6, 1.35, 2.7, mat('#b87537', 0.65, 0.25)); addSolid(rx, rz, 6.6, 3.0, 3.5)
  addBox(rx - 0.5, 2.25, rz + 0.05, 2.0, 1.65, 2.25, mat('#35505a', 0.3, 0.2))
  addBox(rx - 0.5, 3.1, rz + 0.05, 2.08, 0.12, 2.32, dark)
  for (const wx of [rx - 2.15, rx + 2.15]) for (const wz of [rz - 1.45, rz + 1.45]) {
    addCylinder(wx, 0.69, wz, 0.67, 0.44, mat('#20282b', 0.95), true)
    addCylinder(wx, 0.69, wz + (wz < rz ? -0.24 : 0.24), 0.25, 0.46, steel, true)
  }
  const boom = addBox(rx + 1.3, 3.15, rz - 0.06, 4.8, 0.38, 0.42, warmSteel); boom.rotation.z = -0.16
  addBox(rx + 3.53, 2.58, rz - 0.06, 0.22, 1.36, 0.25, dark)
  addBox(rx + 3.5, 1.91, rz - 0.06, 2.5, 0.18, 2.6, steel)
  addBox(rx - 2.85, 0.85, rz, 0.42, 1.1, 2.25, mat('#c48b49'))

  // Tower gantry crane on the left rear apron; crossbeam, trolley, cables and spreader frame.
  const craneX = -31, craneZ = -25
  for (const z of [craneZ - 8.5, craneZ + 8.5]) {
    addBox(craneX, 12, z, 1.1, 24, 1.15, steel)
    addBox(craneX, 1.0, z, 5.6, 1.6, 2.1, dark)
    addBox(craneX, 2.5, z, 3.5, 0.32, 1.5, warmSteel)
  }
  addBox(craneX, 24, craneZ, 1.25, 1.35, 20.4, warmSteel)
  addBox(craneX, 23.15, craneZ, 1.7, 0.3, 20.6, steel)
  for (let i = -8; i <= 8; i += 2) addBox(craneX + i * 0.58, 24, craneZ, 1.12, 1.8, 0.18, steel, false)
  addBox(craneX + 0.1, 24.9, craneZ - 1.2, 2.1, 0.55, 3.5, dark)
  for (const z of [craneZ - 0.45, craneZ + 0.45]) addBox(craneX + 0.1, 19.1, z - 1.2, 0.055, 10.2, 0.055, dark, false)
  addBox(craneX + 0.1, 14.0, craneZ - 1.2, 2.0, 0.18, 3.1, cream)
  // Catwalk handrails and ladder rungs.
  for (const z of [craneZ - 9.7, craneZ + 9.7]) addBox(craneX, 21.9, z, 1.5, 0.12, 0.1, cream, false)
  for (let y = 5; y < 19; y += 1.1) addBox(craneX - 0.65, y, craneZ + 8.7, 0.08, 0.08, 0.8, warmSteel, false)

  // Port edge and dark, gently banded water beyond the working apron.
  const waterMat = new THREE.MeshStandardMaterial({ color: '#294a54', roughness: 0.26, metalness: 0.48 })
  const water = new THREE.Mesh(new THREE.PlaneGeometry(170, 36), waterMat); water.rotation.x = -Math.PI / 2; water.position.set(0, -0.55, -63); group.add(water)
  addBox(0, -0.08, -45.7, 92, 0.35, 2.2, dark)
  const waveMat = new THREE.MeshStandardMaterial({ color: '#809397', roughness: 0.4, metalness: 0.2, transparent: true, opacity: 0.28 })
  for (let i = 0; i < 42; i++) {
    const x = (random() - 0.5) * 95, z = -49 - random() * 28, length = 0.7 + random() * 3.5
    const line = addBox(x, -0.49, z, length, 0.014, 0.035, waveMat, false); line.userData.wave = i * 0.7
  }

  // Distant ship silhouettes and dock cranes dissolve into the haze.
  const shipMat = mat('#34464b', 0.82, 0.18)
  const addShip = (x: number, z: number, scale: number) => {
    addBox(x, 1.8 * scale, z, 22 * scale, 2.1 * scale, 5.2 * scale, shipMat)
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.4 * scale, 1.5 * scale, 22 * scale, 8), shipMat)
    hull.rotation.z = Math.PI / 2; hull.position.set(x, 0.65 * scale, z); group.add(hull)
    for (let i = 0; i < 5; i++) addBox(x - 6 * scale + i * 2.5 * scale, 4.0 * scale, z, 1.8 * scale, 2.0 * scale, 4.0 * scale, containerMats[(i + 2) % containerMats.length])
    addBox(x + 8 * scale, 4.2 * scale, z, 2.0 * scale, 5.2 * scale, 3.2 * scale, cream)
  }
  addShip(-23, -67, 1.15); addShip(28, -70, 0.9)
  for (const x of [-47, -13, 14, 47]) {
    const z = -66
    addBox(x, 9, z, 0.42, 18, 0.45, warmSteel, false)
    const beam = addBox(x, 18, z + 5, 0.38, 0.38, 11, warmSteel, false); beam.rotation.x = -0.2
    addBox(x, 10, z + 3.6, 0.1, 14, 0.1, dark, false)
  }

  // Service shed, light poles and restrained amber work lamps.
  const shed = mat('#54514a')
  addBox(32.5, 2.1, -39.6, 8.5, 4.2, 9.2, shed); addSolid(32.5, -39.6, 8.5, 9.2, 4.2)
  addBox(32.5, 4.4, -39.6, 9.2, 0.35, 10.0, dark)
  for (const [x, z] of [[-18, -39], [17, -37], [34, -22]] as [number, number][]) {
    addCylinder(x, 7, z, 0.12, 14, steel)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.52), new THREE.MeshStandardMaterial({ color: '#d7a96e', emissive: '#815434', emissiveIntensity: 0.34, roughness: 0.5 }))
    lamp.position.set(x, 13.8, z); group.add(lamp)
  }

  // Sunset dome with a smooth vertex-color gradient; simple geometry, no shader dependency.
  const skyGeo = new THREE.SphereGeometry(180, 36, 24)
  const positions = skyGeo.attributes.position
  const colors: number[] = []
  const topColor = new THREE.Color('#27334a'), midColor = new THREE.Color('#aa6470'), lowColor = new THREE.Color('#e9a46f')
  for (let i = 0; i < positions.count; i++) {
    const t = THREE.MathUtils.clamp(positions.getY(i) / 180, -1, 1)
    const c = t > 0 ? midColor.clone().lerp(topColor, Math.pow(t, 0.72)) : lowColor.clone().lerp(midColor, THREE.MathUtils.clamp((t + 0.32) / 0.32, 0, 1))
    colors.push(c.r, c.g, c.b)
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }))
  sky.position.y = 6; sky.renderOrder = -1; group.add(sky)
  const horizonSun = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: '#e9a77d', transparent: true, opacity: 0.38, depthWrite: false }))
  horizonSun.position.set(-34, 14, -100); horizonSun.lookAt(-34, 14, -63); group.add(horizonSun)

  const hemi = new THREE.HemisphereLight('#cad0d2', '#45413c', 1.05); group.add(hemi)
  const sun = new THREE.DirectionalLight('#ffd0a1', 2.15); sun.position.set(-28, 38, 18); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -48; sun.shadow.camera.right = 48; sun.shadow.camera.top = 48; sun.shadow.camera.bottom = -48; sun.shadow.camera.far = 120; group.add(sun)
  const fill = new THREE.DirectionalLight('#9db4bf', 0.55); fill.position.set(35, 18, -40); group.add(fill)

  // Bounded drizzle: six hundred points and a matching short streak per point, recycled locally.
  const rainCount = 600
  const rainPositions = new Float32Array(rainCount * 2 * 3)
  const rainGeo = new THREE.BufferGeometry()
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3))
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#bfced0', transparent: true, opacity: 0.28, depthWrite: false }))
  rain.frustumCulled = false; group.add(rain)
  for (let i = 0; i < rainCount; i++) {
    const o = i * 6, x = (random() - 0.5) * 76, y = random() * 24, z = -42 + random() * 62
    rainPositions[o] = x; rainPositions[o + 1] = y; rainPositions[o + 2] = z
    rainPositions[o + 3] = x - 0.08; rainPositions[o + 4] = y - 0.62; rainPositions[o + 5] = z - 0.03
  }
  rainGeo.computeBoundingSphere()
  let elapsed = 0
  return {
    group, solids, spawn: new THREE.Vector3(0, 0, 12),
    update(dt: number, focus: THREE.Vector3, active: boolean) {
      if (!active) return
      elapsed += Math.min(dt, 0.05)
      const p = rainGeo.attributes.position as THREE.BufferAttribute
      for (let i = 0; i < rainCount; i++) {
        const o = i * 6
        let y = p.array[o + 1] as number
        y -= dt * 15
        if (y < 0.1) {
          y = 17 + random() * 7
          p.array[o] = focus.x + (random() - 0.5) * 68
          p.array[o + 2] = focus.z + (random() - 0.5) * 56
        }
        p.array[o + 1] = y; p.array[o + 3] = (p.array[o] as number) - 0.08; p.array[o + 4] = y - 0.62; p.array[o + 5] = (p.array[o + 2] as number) - 0.03
      }
      p.needsUpdate = true
      // The water glints drift subtly rather than flashing; the environment remains low-glare.
      for (const child of group.children) if (child.userData.wave !== undefined) child.position.x += Math.sin(elapsed + (child.userData.wave as number)) * dt * 0.07
    },
  }
}
