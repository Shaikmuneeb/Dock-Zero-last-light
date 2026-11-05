import * as THREE from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { Assets } from '../engine/assets'
import type { Input } from '../engine/input'
import type { Renderer } from '../engine/renderer'
import { createTerminalWorld, type SolidRect, type TerminalWorld } from './terminal-world'
import { createWeaponRig, type WeaponId, type WeaponRig } from './weapon-rig'
import { CHARACTER_ASSET_URLS } from './fps-assets'
import { tuning } from './tuning'

export type GameMode = 'boot' | 'title' | 'playing' | 'paused' | 'intermission' | 'ended'
export type MatchMode = 'survival' | 'ffa'
export type EnemyKind = 'wolf' | 'boar' | 'robot' | 'dog' | 'exosuit'
export type Augment = { id: string; title: string; description: string }
export type HudState = {
  mode: GameMode; match: MatchMode; wave: number; kills: number; score: number; health: number; maxHealth: number; armor: number; maxArmor: number;
  ammo: number; reserve: number; weapon: WeaponId; weaponName: string; style: string; stylePoints: number;
  overdrive: number; overdriveActive: boolean; armorRecharging: boolean; boss: boolean; bossHp: number; bossPhase: number; botsAlive: number; time: number; aiming: boolean;
}
export type GameHooks = {
  screen(mode: GameMode): void
  hud(state: HudState): void
  banner(title: string, detail?: string): void
  popup(text: string, kind?: 'kill' | 'headshot' | 'pickup' | 'damage' | 'style'): void
  hurt(direction: number, armorBreak: boolean): void
  augments(wave: number, options: Augment[]): void
  stage?(status: 'loading' | 'ready' | 'error', wave: number): void
  ended(won: boolean, stats: { kills: number; score: number; wave: number; time: number }): void
}

type Enemy = {
  id: number; kind: EnemyKind; root: THREE.Group; body: THREE.Group; hp: number; maxHp: number; speed: number; height: number;
  attackTimer: number; bob: number; alive: boolean; head: THREE.Object3D; weak: THREE.Mesh; phase: number; targetId: number;
  modelKey: string; mixer?: THREE.AnimationMixer; idleAction?: THREE.AnimationAction; moveAction?: THREE.AnimationAction; animationBlend: number; slideTagged: boolean;
}
type Pickup = { kind: 'health' | 'armor' | 'ammo'; root: THREE.Group; age: number }
type Projectile = { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number; owner: 'player' | 'enemy'; damage: number; selfDamage?: number; blast: number; grenade: boolean; enemyTargetId?: number }
type ParticleFx = { object: THREE.Object3D; age: number; life: number; update?(dt: number): void }
type ModelEntry = { url: string; height: number }
type LoadedModel = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; height: number }

// Registered model URLs are injected after the Three.js asset-sync receipt. Keep every complete
// stable URL in this table so history previews can restore exactly the same runtime dependency.
export const MODEL_URLS: Partial<Record<string, ModelEntry>> = {
  operator: { url: CHARACTER_ASSET_URLS.operator, height: 1.78 },
  'wolf-merc': { url: CHARACTER_ASSET_URLS.wolfMerc, height: 1.82 },
  'white-robot': { url: CHARACTER_ASSET_URLS.whiteRobot, height: 1.76 },
  'robot-dog': { url: CHARACTER_ASSET_URLS.robotDog, height: 0.92 },
  'exosuit-boss': { url: CHARACTER_ASSET_URLS.exosuitBoss, height: 2.38 },
}
const BASE_HP: Record<EnemyKind, number> = { wolf: 90, boar: 118, robot: 105, dog: 78, exosuit: 1100 }
const MODEL_KEY: Record<EnemyKind, string> = { wolf: 'wolf-merc', boar: 'wolf-merc', robot: 'white-robot', dog: 'robot-dog', exosuit: 'exosuit-boss' }
const WEAPON_META: Record<WeaponId, { name: string; mag: number; reserve: number; cadence: number; damage: number; reload: number }> = {
  rifle: { name: 'Kestrel AR', mag: 30, reserve: 180, cadence: 0.095, damage: 20, reload: 1.35 },
  shotgun: { name: 'Breach-8', mag: 8, reserve: 56, cadence: 0.235, damage: 13, reload: 1.0 },
  launcher: { name: 'Harbor AT', mag: 1, reserve: 8, cadence: 0.78, damage: 138, reload: 1.65 },
  grenade: { name: 'M-9 Grenade', mag: 1, reserve: 5, cadence: 0.75, damage: 125, reload: 0.8 },
}
const STYLE_RANKS = ['ROOKIE', 'CLEAN', 'SHARP', 'RELENTLESS', 'APEX', 'DOCK ZERO']
const AUGMENTS: Augment[] = [
  { id: 'plates', title: 'Ceramic Weave', description: '+30 maximum armor; restore 30 armor now.' },
  { id: 'feed', title: 'Hot Feed', description: 'Fire 12% faster. Stacks for the rest of this run.' },
  { id: 'vital', title: 'Field Dressing', description: 'Restore 35 health and raise max health by 10.' },
  { id: 'optic', title: 'Glass Breaker', description: 'Headshots and exposed weak points deal 20% more.' },
  { id: 'scav', title: 'Quartermaster', description: 'Pickups are stronger; refill one magazine.' },
  { id: 'boots', title: 'Mag-Step Soles', description: 'Move 8% faster and keep more speed through a slide.' },
]
const UP = new THREE.Vector3(0, 1, 0)

export class FpsGame {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(74, 1, 0.06, 520)
  readonly player = { position: new THREE.Vector3(0, 0, 12), velocity: new THREE.Vector3(), health: 100, maxHealth: 100, armor: 150, maxArmor: 150, grounded: true, verticalSpeed: 0 }
  readonly world: TerminalWorld
  readonly weapons: WeaponRig
  readonly assets = new Assets()
  readonly run = { score: 0, kills: 0, wave: 1, elapsed: 0, phase: 'playing' as 'playing' | 'won' | 'lost', unranked: false }
  mode: GameMode = 'boot'
  match: MatchMode = 'survival'
  reducedMotion = false
  private readonly enemies: Enemy[] = []
  private readonly pickups: Pickup[] = []
  private readonly projectiles: Projectile[] = []
  private readonly fx: ParticleFx[] = []
  private readonly solids: SolidRect[]
  private readonly raycaster = new THREE.Raycaster()
  private readonly models = new Map<string, LoadedModel>()
  private readonly modelPromises = new Map<string, Promise<LoadedModel>>()
  private readonly stagePromises = new Map<number, Promise<void>>()
  private readonly readyStages = new Set<number>()
  private readonly deferredModels = new Map<string, LoadedModel>()
  private readonly shadow = this.makeShadow()
  private readonly playerSilhouette = new THREE.Group()
  private readonly impacts = new THREE.Group()
  private playerMixer?: THREE.AnimationMixer
  private playerIdleAction?: THREE.AnimationAction
  private playerMoveAction?: THREE.AnimationAction
  private playerAnimationBlend = 0
  private currentWeapon: WeaponId = 'rifle'
  private previousWeapon: WeaponId = 'shotgun'
  private magazine = { rifle: 30, shotgun: 8, launcher: 1, grenade: 1 }
  private reserve = { rifle: 180, shotgun: 56, launcher: 8, grenade: 5 }
  private fireTimer = 0
  private reloadTimer = 0
  private reloadKind: WeaponId | null = null
  private armorDelay = 0
  private slideTimer = 0
  private jumpBuffer = 0
  private lastMove = 0
  private hitStop = 0
  private time = 0
  private hudTimer = 0
  private swapTime = 0
  private stylePoints = 0
  private styleTimer = 0
  private overdriveTime = 0
  private overdriveCharge = 0
  private augmentsOwned = new Set<string>()
  private cadenceBonus = 0
  private damageBonus = 0
  private moveBonus = 0
  private pickupBonus = 1
  private boss?: Enemy
  private deathTimer = 0
  private ambienceTime = 0
  private targetingId = 0
  private pressureFrames = 0
  yaw = 0
  pitch = -0.02
  aiming = false
  crouching = false
  sliding = false

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly hooks: GameHooks) {
    this.world = createTerminalWorld()
    this.solids = this.world.solids
    this.scene.add(this.world.group)
    this.scene.background = new THREE.Color('#dd8a52')
    this.scene.fog = new THREE.FogExp2('#d58a5a', 0.0045)
    this.scene.add(new THREE.HemisphereLight('#e3d9d2', '#242326', 1.5))
    const sun = new THREE.DirectionalLight('#ffd2a0', 2.1)
    sun.position.set(-24, 34, 20); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -52; sun.shadow.camera.right = 52; sun.shadow.camera.top = 52; sun.shadow.camera.bottom = -52
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 110; sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.025
    this.scene.add(sun, sun.target)
    const fill = new THREE.DirectionalLight('#66839a', 0.72); fill.position.set(18, 9, -16); this.scene.add(fill)
    this.scene.add(this.shadow, this.playerSilhouette, this.impacts)
    this.weapons = createWeaponRig()
    this.camera.add(this.weapons.root)
    this.scene.add(this.camera)
    this.camera.position.set(this.player.position.x, 1.67, this.player.position.z)
    this.camera.rotation.order = 'YXZ'
    this.hooks.screen('boot')
  }

  async loadInitialAssets(onProgress: (n: number) => void): Promise<void> {
    const keys = ['operator', 'wolf-merc', 'white-robot']
    const missing = keys.filter(k => !MODEL_URLS[k])
    if (missing.length) throw new Error(`Required first-wave models are not registered: ${missing.join(', ')}`)
    let done = 0
    const tasks = keys.map(async key => {
      await this.loadModel(key)
      onProgress(++done / Math.max(1, keys.length))
    })
    await Promise.all(tasks)
    onProgress(1)
    this.readyStages.add(1)
    this.mode = 'title'
    this.hooks.screen('title')
  }

  async retryInitialAssets(onProgress: (n: number) => void): Promise<void> {
    this.playerMixer?.stopAllAction(); disposeMaterialsOnly(this.playerSilhouette); this.playerSilhouette.clear(); this.playerMixer = undefined; this.playerIdleAction = undefined; this.playerMoveAction = undefined
    this.modelPromises.clear(); this.models.clear(); this.deferredModels.clear(); this.readyStages.delete(1)
    await this.loadInitialAssets(onProgress)
  }

  private async loadModel(key: string): Promise<LoadedModel> {
    if (this.models.has(key)) return this.models.get(key)!
    if (this.modelPromises.has(key)) return this.modelPromises.get(key)!
    const entry = MODEL_URLS[key]
    if (!entry) throw new Error(`Required model is not registered: ${key}`)
    const pending = this.assets.gltf(entry.url).then(gltf => {
      const result = { scene: gltf.scene, animations: gltf.animations, height: entry.height }
      this.models.set(key, result)
      if (key === 'operator') this.installOperatorShadow()
      const enemy = this.enemies.find(e => e.alive && e.modelKey === key && !e.root.userData.modelInstalled)
      if (enemy) {
        if (this.assetIntegrationSafe()) { this.installEnemyModel(enemy, result); enemy.root.userData.modelInstalled = true }
        else this.deferredModels.set(key, result)
      }
      return result
    }).finally(() => this.modelPromises.delete(key))
    this.modelPromises.set(key, pending)
    return pending
  }

  private assetIntegrationSafe(): boolean {
    if (document.hidden) return false
    return this.mode !== 'playing' || (this.enemies.filter(e => e.alive).length < 5 && this.projectiles.length < 5 && this.fx.length < 48 && this.pressureFrames < 3)
  }

  private applyDeferredModel(): void {
    if (!this.assetIntegrationSafe()) return
    for (const [key, model] of this.deferredModels) {
      const enemy = this.enemies.find(e => e.alive && e.modelKey === key && !e.root.userData.modelInstalled)
      if (enemy) { this.installEnemyModel(enemy, model); enemy.root.userData.modelInstalled = true; return }
      this.deferredModels.delete(key)
    }
  }

  private installOperatorShadow(): void {
    const model = this.models.get('operator')
    if (!model) return
    this.playerSilhouette.clear()
    const clone = cloneModel(model.scene)
    normalizeModel(clone, 1.78)
    clone.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true; o.receiveShadow = false
      const materials = Array.isArray(o.material) ? o.material : [o.material]
      o.material = materials.map(m => { const c = m.clone(); c.colorWrite = false; c.depthWrite = false; c.transparent = true; c.opacity = 0; return c })
      if (o.material.length === 1) o.material = o.material[0]
    })
    this.playerSilhouette.add(clone)
    this.playerMixer = new THREE.AnimationMixer(clone)
    const idle = model.animations.find(c => /idle|stand|relax/i.test(c.name))
    const move = model.animations.find(c => /run|walk|move/i.test(c.name))
    this.playerIdleAction = idle ? this.playerMixer.clipAction(idle) : undefined
    this.playerMoveAction = move ? this.playerMixer.clipAction(move) : undefined
    this.playerIdleAction?.setEffectiveWeight(1).play()
    this.playerMoveAction?.setEffectiveWeight(0).play()
    this.playerSilhouette.position.copy(this.player.position)
    this.playerSilhouette.visible = true
  }

  private installEnemyModel(enemy: Enemy, model: LoadedModel): void {
    const old = enemy.body
    enemy.root.remove(old)
    old.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() }
    })
    const clone = cloneModel(model.scene)
    normalizeModel(clone, enemy.height)
    clone.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
    enemy.body = new THREE.Group(); enemy.body.add(clone); enemy.root.add(enemy.body)
    enemy.head = clone.getObjectByName('Head') ?? clone
    if (model.animations.length) {
      enemy.mixer = new THREE.AnimationMixer(clone)
      const idle = model.animations.find(c => /idle|stand|relax/i.test(c.name))
      const move = model.animations.find(c => /run|walk|move/i.test(c.name))
      enemy.idleAction = idle ? enemy.mixer.clipAction(idle) : undefined
      enemy.moveAction = move ? enemy.mixer.clipAction(move) : undefined
      enemy.idleAction?.setEffectiveWeight(1).play()
      enemy.moveAction?.setEffectiveWeight(0).play()
    }
    if (enemy.kind === 'boar') addBoarMask(enemy.body)
    if (enemy.kind === 'exosuit') this.installBossWeakPoint(enemy)
  }

  private installBossWeakPoint(enemy: Enemy): void {
    const weak = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshStandardMaterial({ color: '#ff9b43', emissive: '#d24916', emissiveIntensity: 1.0, roughness: 0.3 }))
    weak.name = 'Exposed weak point'; weak.position.set(0, 1.28, 0.12); weak.userData.weakpoint = true; weak.visible = enemy.phase >= 2
    enemy.body.add(weak); enemy.weak = weak
  }

  async warmStage(wave: number): Promise<void> {
    if (this.readyStages.has(wave)) { this.hooks.stage?.('ready', wave); return }
    if (this.mode === 'playing' && !this.assetIntegrationSafe()) return
    if (document.hidden) return
    const existing = this.stagePromises.get(wave)
    if (existing) { this.hooks.stage?.('loading', wave); await existing; this.hooks.stage?.('ready', wave); return }
    const keys = wave >= 8 ? ['exosuit-boss', 'robot-dog'] : wave >= 3 ? ['robot-dog', 'white-robot'] : ['wolf-merc', 'white-robot']
    this.hooks.stage?.('loading', wave)
    const pending = Promise.all(keys.map(k => this.loadModel(k))).then(() => undefined)
    this.stagePromises.set(wave, pending)
    try {
      await pending
      this.readyStages.add(wave)
      this.hooks.stage?.('ready', wave)
    } catch (error) {
      this.hooks.stage?.('error', wave)
      throw error
    } finally {
      if (this.stagePromises.get(wave) === pending) this.stagePromises.delete(wave)
    }
  }

  retryStage(wave: number): void {
    this.readyStages.delete(wave)
    this.stagePromises.delete(wave)
    void this.warmStage(wave).catch(() => undefined)
  }

  start(match: MatchMode): void {
    tuning.activate('run')
    this.resetWorldState()
    this.match = match
    this.run.phase = 'playing'; this.run.elapsed = 0; this.run.wave = 1; this.run.kills = 0; this.run.score = 0; this.run.unranked = tuning.unranked
    this.player.position.copy(this.world.spawn); this.player.velocity.set(0, 0, 0); this.player.health = 100; this.player.maxHealth = 100
    this.player.armor = 150; this.player.maxArmor = 150; this.player.verticalSpeed = 0; this.player.grounded = true
    this.yaw = 0; this.pitch = -0.02; this.crouching = false; this.sliding = false; this.slideTimer = 0
    this.fireTimer = 0; this.reloadTimer = 0; this.reloadKind = null; this.armorDelay = 0; this.swapTime = 0; this.hitStop = 0; this.deathTimer = 0; this.hudTimer = 0
    this.stylePoints = 0; this.styleTimer = 0; this.overdriveCharge = 0; this.overdriveTime = 0
    this.augmentsOwned.clear(); this.cadenceBonus = 0; this.damageBonus = 0; this.moveBonus = 0; this.pickupBonus = 1
    this.currentWeapon = 'rifle'; this.previousWeapon = 'shotgun'; this.magazine = { rifle: 30, shotgun: 8, launcher: 1, grenade: 1 }; this.reserve = { rifle: 180, shotgun: 56, launcher: 8, grenade: 5 }
    this.weapons.equip('rifle')
    this.mode = 'playing'; this.hooks.screen('playing'); this.hooks.banner(match === 'survival' ? 'FIRST WAVE' : 'FREE FOR ALL', 'Six combatants. No backup.')
    if (match === 'survival') this.beginWave(1); else this.beginFfa()
    void this.warmStage(2).catch(() => undefined)
  }

  pause(): void {
    if (this.mode !== 'playing') return
    this.mode = 'paused'; this.hooks.screen('paused')
  }
  resume(): void { if (this.mode !== 'paused') return; this.mode = 'playing'; this.hooks.screen('playing'); this.input.takeLook() }
  toTitle(): void { this.resetWorldState(); this.mode = 'title'; this.hooks.screen('title') }
  setQuality(quality: 'low' | 'medium' | 'high'): void { this.renderer.applyQuality(quality) }
  async chooseAugment(index: number): Promise<void> {
    if (this.mode !== 'intermission') return
    const options = this.currentAugments
    const choice = options[index]
    if (!choice) return
    const nextWave = this.run.wave + 1
    try { await this.warmStage(nextWave) } catch { return }
    if (this.mode !== 'intermission') return
    this.applyAugment(choice)
    if (this.run.wave >= 8) { this.finish(true); return }
    this.run.wave += 1; this.mode = 'playing'; this.hooks.screen('playing')
    this.hooks.banner(`WAVE ${String(this.run.wave).padStart(2, '0')}`, 'Choose your lane. They are already moving.')
    this.beginWave(this.run.wave)
    void this.warmStage(this.run.wave + 1)
  }
  private currentAugments: Augment[] = []

  step(dt: number): void {
    this.time += dt
    if (this.mode !== 'playing') return
    if (this.hitStop > 0) { this.hitStop = Math.max(0, this.hitStop - dt); return }
    this.run.elapsed += dt
    this.fireTimer = Math.max(0, this.fireTimer - dt); this.armorDelay = Math.max(0, this.armorDelay - dt)
    this.styleTimer = Math.max(0, this.styleTimer - dt); this.swapTime = Math.max(0, this.swapTime - dt)
    this.overdriveTime = Math.max(0, this.overdriveTime - dt); this.slideTimer = Math.max(0, this.slideTimer - dt)
    if (this.slideTimer <= 0) this.sliding = false
    this.aiming = this.input.held('aim')
    this.crouching = this.input.held('crouch')
    if (this.input.consume('weapon1')) this.switchWeapon('rifle')
    if (this.input.consume('weapon2')) this.switchWeapon('shotgun')
    if (this.input.consume('weapon3')) this.switchWeapon('launcher')
    if (this.input.consume('weapon4')) this.switchWeapon('grenade')
    if (this.input.consume('weaponNext')) this.quickSwitch()
    if (this.input.consume('reload')) this.beginReload()
    if (this.input.consume('grenade')) this.throwGrenade()
    if (this.input.consume('melee')) this.melee()
    if (this.input.consume('overdrive')) this.activateOverdrive()
    if (this.input.consume('jump')) this.jumpBuffer = 0.12
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt)

    this.movePlayer(dt)
    this.camera.position.set(this.player.position.x, this.player.position.y + (this.crouching || this.sliding ? 1.08 : 1.64), this.player.position.z)
    const look = this.input.takeLook()
    this.yaw -= look.x; this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -1.28, 1.15)
    this.updateCamera(dt)
    this.updateWeapon(dt)
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0 && this.reloadKind) this.finishReload(this.reloadKind)
    }
    this.armorRecharge(dt)
    this.updateEnemies(dt)
    this.updateProjectiles(dt)
    this.updatePickups(dt)
    this.updateFx(dt)
    if (this.input.held('fire')) this.fireCurrent()
    this.hudTimer -= dt
    if (this.hudTimer <= 0) { this.hudTimer = 0.06; this.hooks.hud(this.hudState()) }
    this.checkWaveClear()
    if (this.player.health <= 0 && this.mode === 'playing') this.finish(false)
    if (this.enemies.length > 0 && this.enemies.filter(e => e.alive).length <= 3) void this.warmStage(Math.min(8, this.run.wave + 1)).catch(() => undefined)
  }

  render(_alpha: number, frameSeconds: number): void {
    const dt = Math.min(frameSeconds, 0.05)
    this.pressureFrames = frameSeconds > 0.032 ? Math.min(8, this.pressureFrames + 1) : Math.max(0, this.pressureFrames - 1)
    this.ambienceTime += dt
    this.applyDeferredModel()
    this.world.update(dt, this.camera.position, this.mode === 'playing')
    this.updateCamera(dt)
    this.updateWeapon(dt)
    const animDt = this.mode === 'playing' ? dt : 0
    this.playerAnimationBlend = THREE.MathUtils.damp(this.playerAnimationBlend, this.mode === 'playing' ? THREE.MathUtils.clamp(this.lastMove / 4.5, 0, 1) : 0, 9, dt)
    this.playerIdleAction?.setEffectiveWeight(1 - this.playerAnimationBlend)
    this.playerMoveAction?.setEffectiveWeight(this.playerAnimationBlend)
    this.playerMixer?.update(animDt)
    for (const enemy of this.enemies) {
      enemy.idleAction?.setEffectiveWeight(1 - enemy.animationBlend)
      enemy.moveAction?.setEffectiveWeight(enemy.animationBlend)
      enemy.mixer?.update(animDt)
      if (enemy.kind === 'dog') { enemy.body.rotation.x = Math.sin(enemy.bob) * 0.025; enemy.body.rotation.z = Math.sin(enemy.bob * 0.5) * 0.035 }
    }
    this.renderer.render(this.scene, this.camera)
  }

  hudState(): HudState {
    const meta = WEAPON_META[this.currentWeapon]
    const boss = this.boss && this.boss.alive ? this.boss : undefined
    return { mode: this.mode, match: this.match, wave: this.run.wave, kills: this.run.kills, score: this.run.score, health: this.player.health,
      maxHealth: this.player.maxHealth, maxArmor: this.player.maxArmor, armor: this.player.armor,
      ammo: this.overdriveTime > 0 ? 999 : this.magazine[this.currentWeapon], reserve: this.reserve[this.currentWeapon],
      weapon: this.currentWeapon, weaponName: meta.name, style: STYLE_RANKS[Math.min(STYLE_RANKS.length - 1, Math.floor(this.stylePoints / 180))],
      stylePoints: this.stylePoints, overdrive: this.overdriveTime > 0 ? this.overdriveTime / 8 : this.overdriveCharge / 100,
      overdriveActive: this.overdriveTime > 0,
      armorRecharging: this.armorDelay <= 0 && this.player.armor < this.player.maxArmor,
      boss: !!boss, bossHp: boss ? Math.max(0, boss.hp / boss.maxHp) : 0, bossPhase: boss?.phase ?? 1,
      botsAlive: this.match === 'ffa' ? this.enemies.filter(e => e.alive).length + (this.player.health > 0 ? 1 : 0) : 0, time: this.run.elapsed, aiming: this.aiming }
  }

  private resetWorldState(): void {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.root)
      // SkeletonUtils clones intentionally share registered GLB geometries/materials with the
      // cached source; dispose only generated fallbacks and retain the shared model cache.
      if (!enemy.root.userData.modelInstalled) disposeTree(enemy.root)
    }
    this.enemies.length = 0
    for (const pickup of this.pickups) { this.scene.remove(pickup.root); disposeTree(pickup.root) }
    this.pickups.length = 0
    for (const projectile of this.projectiles) { this.scene.remove(projectile.mesh); disposeTree(projectile.mesh) }
    this.projectiles.length = 0
    for (const fx of this.fx) { this.scene.remove(fx.object); disposeTree(fx.object) }
    this.fx.length = 0
    this.boss = undefined
    this.mode = 'title'
  }

  private beginWave(wave: number): void {
    const count = Math.min(7, 3 + Math.floor((wave + 1) / 2))
    const kinds: EnemyKind[] = []
    for (let i = 0; i < count; i++) {
      if (wave >= 6 && i % 4 === 3) kinds.push('exosuit')
      else if (wave >= 3 && i % 3 === 2) kinds.push('dog')
      else if (i % 4 === 1) kinds.push(wave % 2 ? 'robot' : 'boar')
      else kinds.push('wolf')
    }
    if (wave === 8) {
      this.spawnEnemy('exosuit', new THREE.Vector3(0, 0, -30), true)
      for (let i = 0; i < 4; i++) this.spawnEnemy(i % 2 ? 'robot' : 'dog', new THREE.Vector3((i - 1.5) * 7, 0, -22 - (i % 2) * 4))
    } else {
      kinds.forEach((kind, i) => {
        const x = (i % 2 ? 1 : -1) * (10 + (i % 3) * 4) + (i > 3 ? (i - 3) * 2 : 0)
        this.spawnEnemy(kind, new THREE.Vector3(x, 0, -18 - Math.floor(i / 2) * 9))
      })
    }
    if (wave === 8) this.hooks.banner('THE IRON WARDEN', 'Three systems. One weak core.')
  }

  private beginFfa(): void {
    const kinds: EnemyKind[] = ['wolf', 'robot', 'boar', 'dog', 'robot', 'wolf']
    const spots = [new THREE.Vector3(-22, 0, -22), new THREE.Vector3(-9, 0, -36), new THREE.Vector3(11, 0, -32), new THREE.Vector3(22, 0, -15), new THREE.Vector3(14, 0, 5), new THREE.Vector3(-16, 0, -8)]
    kinds.forEach((kind, i) => this.spawnEnemy(kind, spots[i], false, true))
  }

  private spawnEnemy(kind: EnemyKind, pos: THREE.Vector3, boss = false, ffa = false): Enemy {
    const root = new THREE.Group(); root.position.copy(pos); root.userData.actor = true
    const body = makeFallback(kind); root.add(body)
    const scale = kind === 'dog' ? 0.82 : kind === 'exosuit' ? 2.55 : 1.82
    const weak = new THREE.Mesh(new THREE.SphereGeometry(kind === 'exosuit' ? 0.14 : 0.085, 12, 8), new THREE.MeshStandardMaterial({ color: kind === 'robot' ? '#ffb354' : '#d7432c', emissive: kind === 'robot' ? '#d27a24' : '#872719', emissiveIntensity: 0.8 }))
    weak.name = 'weakpoint'; weak.position.set(0, kind === 'dog' ? 0.5 : scale * 0.82, kind === 'dog' ? -0.2 : -0.05); weak.userData.weakpoint = kind === 'exosuit'
    body.add(weak)
    const hp = (boss ? BASE_HP.exosuit + 1250 : BASE_HP[kind] + (this.match === 'survival' ? (this.run.wave - 1) * 12 : 15)) * tuning.value('combat.enemyHealth')
    const enemy: Enemy = { id: this.targetingId++, kind, root, body, hp, maxHp: hp, speed: kind === 'dog' ? 6.3 : kind === 'exosuit' ? 2.0 : 2.55,
      height: scale, attackTimer: 0.8 + Math.random(), bob: Math.random() * 6, alive: true, head: weak, weak, phase: 1, targetId: -1, modelKey: MODEL_KEY[kind], animationBlend: 0, slideTagged: false }
    root.userData.enemy = enemy; root.userData.ffa = ffa
    this.scene.add(root); this.enemies.push(enemy)
    const model = this.models.get(enemy.modelKey)
    if (model) { this.installEnemyModel(enemy, model); root.userData.modelInstalled = true }
    if (boss) { this.boss = enemy; enemy.weak.name = 'Exposed weak point'; enemy.weak.position.set(0, 1.28, 0.12); enemy.weak.visible = false }
    return enemy
  }

  private movePlayer(dt: number): void {
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const right = new THREE.Vector3().crossVectors(forward, UP)
    const wish = right.multiplyScalar(this.input.move.x).addScaledVector(forward, this.input.move.y)
    const mag = Math.min(1, wish.length()); if (mag > 0.001) wish.normalize()
    const speedNow = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    const wasGrounded = this.player.grounded
    if (this.crouching && this.input.held('sprint') && speedNow > 4 && !this.sliding) { this.sliding = true; this.slideTimer = 0.62; this.hooks.popup('SLIDE', 'style'); this.audioCue('slide') }
    if (this.sliding && this.slideTimer > 0 && speedNow > 0.1) {
      const momentum = new THREE.Vector3(this.player.velocity.x, 0, this.player.velocity.z).normalize().multiplyScalar(tuning.value('player.slideSpeed') + this.moveBonus)
      this.player.velocity.x += (momentum.x - this.player.velocity.x) * Math.min(1, dt * 4)
      this.player.velocity.z += (momentum.z - this.player.velocity.z) * Math.min(1, dt * 4)
    } else {
      const sprint = this.input.held('sprint') && !this.crouching
      const speed = (sprint ? tuning.value('player.sprintSpeed') : tuning.value('player.walkSpeed')) * (this.crouching ? 0.62 : 1) * (1 + this.moveBonus) * (this.overdriveTime > 0 ? 1.08 : 1)
      const targetX = wish.x * speed * mag, targetZ = wish.z * speed * mag
      const k = 1 - Math.exp(-(mag > 0 ? 15 : 9) * dt)
    this.player.velocity.x += (targetX - this.player.velocity.x) * k; this.player.velocity.z += (targetZ - this.player.velocity.z) * k
    }
    const proposed = this.player.position.clone()
    proposed.x += this.player.velocity.x * dt; proposed.z += this.player.velocity.z * dt
    const radius = 0.34
    proposed.x = THREE.MathUtils.clamp(proposed.x, -38, 38); proposed.z = THREE.MathUtils.clamp(proposed.z, -48, 23)
    this.resolveAxis(proposed, 'x', radius); this.resolveAxis(proposed, 'z', radius)
    this.player.position.x = proposed.x; this.player.position.z = proposed.z
    if (this.jumpBuffer > 0 && this.player.grounded && !this.sliding) { this.player.verticalSpeed = tuning.value('player.jumpSpeed'); this.player.grounded = false; this.jumpBuffer = 0; this.hooks.popup('AIRBORNE', 'style'); this.audioCue('jump') }
    if (!this.player.grounded) { this.player.verticalSpeed -= 20 * dt; this.player.position.y += this.player.verticalSpeed * dt }
    if (this.player.position.y <= 0) { this.player.position.y = 0; this.player.verticalSpeed = 0; this.player.grounded = true }
    if (!wasGrounded && this.player.grounded) this.audioCue('landing')
    this.lastMove = Math.hypot(this.player.velocity.x, this.player.velocity.z)
    this.shadow.position.set(this.player.position.x, 0.022, this.player.position.z)
    this.shadow.scale.set(1 + this.player.position.y * 0.07, 1 + this.player.position.y * 0.07, 1)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.08, 0.31 - this.player.position.y * 0.026)
    this.playerSilhouette.position.set(this.player.position.x, this.player.position.y, this.player.position.z)
    this.playerSilhouette.rotation.y = this.yaw + Math.PI
  }

  private resolveAxis(p: THREE.Vector3, axis: 'x' | 'z', radius: number): void {
    for (const s of this.solids) {
      if (this.player.position.y > s.height + 0.2) continue
      const inside = p.x + radius > s.minX && p.x - radius < s.maxX && p.z + radius > s.minZ && p.z - radius < s.maxZ
      if (!inside) continue
      if (axis === 'x') {
        if (this.player.position.x <= s.minX) p.x = Math.min(p.x, s.minX - radius)
        else if (this.player.position.x >= s.maxX) p.x = Math.max(p.x, s.maxX + radius)
        else p.x = Math.abs(p.x - s.minX) < Math.abs(p.x - s.maxX) ? s.minX - radius : s.maxX + radius
      } else {
        if (this.player.position.z <= s.minZ) p.z = Math.min(p.z, s.minZ - radius)
        else if (this.player.position.z >= s.maxZ) p.z = Math.max(p.z, s.maxZ + radius)
        else p.z = Math.abs(p.z - s.minZ) < Math.abs(p.z - s.maxZ) ? s.minZ - radius : s.maxZ + radius
      }
    }
  }

  private updateCamera(dt: number): void {
    const aimFov = this.aiming && (this.currentWeapon === 'rifle' || this.currentWeapon === 'shotgun') ? (this.currentWeapon === 'rifle' ? tuning.value('camera.rifleFov') : tuning.value('camera.shotgunFov')) : tuning.value('camera.hipFov')
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, aimFov, 10, dt); this.camera.updateProjectionMatrix()
    this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(this.pitch, this.yaw, 0)
  }

  private updateWeapon(dt: number): void {
    this.weapons.animate(dt, this.lastMove / 9, this.crouching, this.sliding, this.aiming)
  }

  private switchWeapon(id: WeaponId): void {
    if (id === this.currentWeapon) return
    this.previousWeapon = this.currentWeapon; this.currentWeapon = id; this.weapons.equip(id); this.reloadTimer = 0; this.reloadKind = null
    this.swapTime = 0.72; this.addStyle(12); this.hooks.popup(WEAPON_META[id].name, 'style')
  }
  private quickSwitch(): void { this.switchWeapon(this.previousWeapon) }
  private beginReload(): void {
    const meta = WEAPON_META[this.currentWeapon]
    if (this.reloadTimer > 0 || this.magazine[this.currentWeapon] >= meta.mag || this.reserve[this.currentWeapon] <= 0 || this.overdriveTime > 0) return
    this.reloadTimer = meta.reload; this.reloadKind = this.currentWeapon; this.audioCue('reload')
  }
  private finishReload(id: WeaponId): void {
    const meta = WEAPON_META[id]; const amount = Math.min(meta.mag - this.magazine[id], this.reserve[id])
    this.magazine[id] += amount; this.reserve[id] -= amount; this.reloadKind = null
  }

  private fireCurrent(): void {
    if (this.reloadTimer > 0 || this.fireTimer > 0) return
    const meta = WEAPON_META[this.currentWeapon]
    if (this.magazine[this.currentWeapon] <= 0 && this.overdriveTime <= 0) { this.fireTimer = 0.22; this.beginReload(); return }
    const cadence = meta.cadence / (1 + this.cadenceBonus + (this.overdriveTime > 0 ? 0.62 : 0))
    this.fireTimer = cadence
    if (this.overdriveTime <= 0) this.magazine[this.currentWeapon] = Math.max(0, this.magazine[this.currentWeapon] - 1)
    this.weapons.fireKick()
    if (this.currentWeapon === 'rifle') { this.fireHitscan(meta.damage, 1, 0.008); this.audioCue('rifle') }
    else if (this.currentWeapon === 'shotgun') { this.fireHitscan(meta.damage, 9, 0.052); this.audioCue('shotgun') }
    else if (this.currentWeapon === 'launcher') this.launchProjectile(meta.damage, 11.5, 5.0, false)
    else this.throwGrenade()
  }

  private fireHitscan(baseDamage: number, pellets: number, spread: number): void {
    this.camera.updateMatrixWorld(true)
    const origin = this.camera.getWorldPosition(new THREE.Vector3())
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const tracerEnds: THREE.Vector3[] = []
    const seen = new Set<number>()
    for (let i = 0; i < pellets; i++) {
      const shot = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread)).normalize()
      this.raycaster.set(origin, shot)
      const coverDistance = this.blockingDistance(origin, shot, 110)
      this.raycaster.far = coverDistance
      const hit = this.raycaster.intersectObjects(this.enemies.filter(e => e.alive).map(e => e.root), true)[0]
      const end = hit?.point.clone() ?? origin.clone().addScaledVector(shot, coverDistance)
      tracerEnds.push(end)
      if (!hit) { if (coverDistance < 109.95) this.makeImpact(end, '#9a9c91', 0.44); continue }
      let object: THREE.Object3D | null = hit.object
      let enemy: Enemy | undefined
      while (object && !enemy) { enemy = object.userData.enemy as Enemy | undefined; object = object.parent }
      enemy ??= this.enemies.find(e => hit.object.parent === e.root || e.root.getObjectById(hit.object.id))
      if (!enemy || !enemy.alive || seen.has(enemy.id)) continue
      seen.add(enemy.id)
      const headshot = this.isPrecisionHit(enemy, hit.object, hit.point)
      const weak = hit.object.userData.weakpoint === true && (enemy.kind !== 'exosuit' || enemy.phase >= 2) || hit.object === enemy.weak && (enemy.kind !== 'exosuit' || enemy.phase >= 2)
      const mult = 1.25 * tuning.value('combat.playerDamage') * (headshot || weak ? 2.05 + this.damageBonus : 1)
      this.damageEnemy(enemy, baseDamage * mult, headshot || weak, this.sliding, this.player.position.y > 0.38)
      this.makeImpact(hit.point, headshot || weak ? '#ffb347' : '#dbd0ba', headshot || weak ? 1.2 : 0.8)
    }
    this.tracer(origin, tracerEnds[0] ?? origin.clone().addScaledVector(dir, 60), this.currentWeapon === 'shotgun' ? '#ffc683' : '#ffd39a')
    this.shellCasing()
    this.flashAt(this.weapons.muzzleWorld(this.camera), this.currentWeapon === 'shotgun' ? '#ffcb81' : '#ffd8a1')
  }

  private isPrecisionHit(enemy: Enemy, object: THREE.Object3D, p: THREE.Vector3): boolean {
    if (object.userData.weakpoint) return enemy.kind !== 'exosuit' || enemy.phase >= 2
    if (object.name.toLowerCase().includes('head')) return true
    const localY = p.y - enemy.root.position.y
    return localY > enemy.height * (enemy.kind === 'dog' ? 0.7 : 0.77)
  }

  private blockingDistance(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): number {
    let nearest = maxDistance
    for (const solid of this.solids) {
      const lo = [solid.minX, 0, solid.minZ], hi = [solid.maxX, solid.height, solid.maxZ]
      const o = [origin.x, origin.y, origin.z], d = [direction.x, direction.y, direction.z]
      let near = -Infinity, far = Infinity, intersects = true
      for (let axis = 0; axis < 3; axis++) {
        if (Math.abs(d[axis]) < 1e-7) { if (o[axis] < lo[axis] || o[axis] > hi[axis]) { intersects = false; break }; continue }
        let a = (lo[axis] - o[axis]) / d[axis], b = (hi[axis] - o[axis]) / d[axis]
        if (a > b) [a, b] = [b, a]
        near = Math.max(near, a); far = Math.min(far, b)
        if (near > far) { intersects = false; break }
      }
      const distance = near >= 0 ? near : far >= 0 ? far : Infinity
      if (intersects && distance > 0.015 && distance < nearest) nearest = distance
    }
    return nearest
  }

  private insideCover(point: THREE.Vector3): boolean {
    return this.solids.some(s => point.y >= 0 && point.y <= s.height && point.x >= s.minX && point.x <= s.maxX && point.z >= s.minZ && point.z <= s.maxZ)
  }

  private damageEnemy(enemy: Enemy, amount: number, precision: boolean, sliding: boolean, airborne: boolean): void {
    if (!enemy.alive) return
    enemy.hp -= amount
    this.hitStop = Math.max(this.hitStop, precision ? 0.036 : 0.018)
    if (precision) this.hooks.popup('WEAK POINT', 'headshot')
    if (enemy.kind === 'exosuit') {
      const ratio = enemy.hp / enemy.maxHp
      const phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3
      if (phase !== enemy.phase) { enemy.phase = phase; enemy.speed += 0.55; enemy.weak.visible = phase >= 2; this.hooks.banner(`SYSTEM ${phase} // ${phase === 2 ? 'OVERDRIVE' : 'CORE EXPOSED'}`, 'Break the amber core'); this.audioCue('bossStomp') }
    }
    if (enemy.hp <= 0) this.killEnemy(enemy, precision, sliding, airborne)
  }
  private killEnemy(enemy: Enemy, precision: boolean, sliding: boolean, airborne: boolean): void {
    if (!enemy.alive) return
    enemy.alive = false; enemy.root.visible = false; enemy.hp = 0; this.run.kills++
    const points = precision ? 330 : 170
    this.run.score += points; this.overdriveCharge = Math.min(100, this.overdriveCharge + (precision ? 26 : 18))
    this.addStyle(precision ? 85 : 50); if (sliding && !enemy.slideTagged) { this.addStyle(55); enemy.slideTagged = true; this.hooks.popup('SLIDE KILL', 'style') }
    if (airborne) { this.addStyle(55); this.hooks.popup('AIRBORNE KILL', 'style') }
    this.hooks.popup(precision ? 'PRECISION +330' : '+170', precision ? 'headshot' : 'kill')
    this.dropPickup(enemy.root.position)
    if (enemy === this.boss) this.boss = undefined
    this.flashAt(enemy.root.position.clone().add(new THREE.Vector3(0, enemy.height * 0.55, 0)), '#ff9e51')
    this.fxBurst(enemy.root.position.clone().add(new THREE.Vector3(0, enemy.height * 0.45, 0)), enemy.kind === 'robot' || enemy.kind === 'dog' ? '#bbd1d6' : '#d28455', 18)
    if (enemy.root.userData.ffa) {
      // FFA actors can still be hit by their opponents while dead bodies remain as short-lived props.
      this.deathTimer += 0.35
    } else this.deathTimer += 0.15
    window.setTimeout(() => { this.scene.remove(enemy.root) }, 1800)
    if (this.run.kills % 5 === 0 && this.run.kills > 0) this.hooks.popup('OVERDRIVE +', 'style')
  }

  private launchProjectile(baseDamage: number, speed: number, blast: number, grenade: boolean, cue: 'rocket' | 'grenade' = 'rocket'): void {
    this.camera.updateMatrixWorld(true)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize()
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(grenade ? 0.12 : 0.19, 14, 10), new THREE.MeshStandardMaterial({ color: grenade ? '#354044' : '#647077', roughness: 0.38, metalness: 0.68, emissive: '#e55322', emissiveIntensity: 0.35 }))
    const origin = this.weapons.muzzleWorld(this.camera); mesh.position.copy(origin)
    this.scene.add(mesh); this.projectiles.push({ mesh, velocity: dir.multiplyScalar(speed).add(new THREE.Vector3(0, grenade ? 4.2 : 0, 0)), life: grenade ? 2.2 : 5, owner: 'player', damage: baseDamage * 1.25 * tuning.value('combat.playerDamage'), selfDamage: baseDamage, blast, grenade })
    this.audioCue(cue)
  }
  private throwGrenade(): void {
    if (this.currentWeapon !== 'grenade' && this.reserve.grenade <= 0 || this.currentWeapon === 'grenade' && this.magazine.grenade <= 0 && this.overdriveTime <= 0) return
    if (this.fireTimer > 0.12) return
    if (this.overdriveTime <= 0) { if (this.currentWeapon === 'grenade') this.magazine.grenade--; else this.reserve.grenade-- }
    this.fireTimer = 0.75
    this.launchProjectile(125, 9.8, 5.2, true, 'grenade')
  }
  private melee(): void {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const target = this.player.position.clone().addScaledVector(dir, 2.5)
    const e = this.enemies.filter(x => x.alive).sort((a, b) => a.root.position.distanceToSquared(target) - b.root.position.distanceToSquared(target))[0]
    if (e && e.root.position.distanceTo(target) < 2.6) {
      const isWeak = e.kind === 'exosuit' && e.phase >= 2
      this.damageEnemy(e, 62 * 1.25 * tuning.value('combat.playerDamage') * (isWeak ? 2 : 1), isWeak, this.sliding, this.player.position.y > 0.35)
      this.hooks.popup(isWeak ? 'CORE BREAK' : 'MELEE', 'headshot'); this.audioCue('melee')
    } else this.audioCue('melee')
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue
      enemy.bob += dt * (enemy.kind === 'dog' ? 10 : 3.4)
      const pos = enemy.root.position
      let target = this.player.position
      let targetEnemy: Enemy | undefined
      if (this.match === 'ffa' && enemy.root.userData.ffa) {
        const others = this.enemies.filter(other => other !== enemy && other.alive)
        const nearest = others.sort((a, b) => a.root.position.distanceToSquared(pos) - b.root.position.distanceToSquared(pos))[0]
        if (nearest && nearest.root.position.distanceToSquared(pos) < this.player.position.distanceToSquared(pos) * 1.45) { target = nearest.root.position; targetEnemy = nearest }
      }
      const dx = target.x - pos.x, dz = target.z - pos.z, dist = Math.hypot(dx, dz)
      const moving = dist > (enemy.kind === 'dog' ? 1.7 : 9)
      enemy.animationBlend = THREE.MathUtils.damp(enemy.animationBlend, moving ? 1 : 0, 8, dt)
      if (moving) { const pace = enemy.speed * (this.overdriveTime > 0 ? 0.96 : 1); pos.x += (dx / Math.max(dist, 0.01)) * pace * dt; pos.z += (dz / Math.max(dist, 0.01)) * pace * dt }
      enemy.root.rotation.y = Math.atan2(dx, dz)
      enemy.root.position.y = enemy.kind === 'dog' ? Math.abs(Math.sin(enemy.bob)) * 0.1 : Math.sin(enemy.bob) * 0.025
      if (enemy.weak) { enemy.weak.visible = enemy.kind !== 'exosuit' || enemy.phase >= 2; (enemy.weak.material as THREE.MeshStandardMaterial).emissiveIntensity = enemy.kind === 'exosuit' && enemy.phase > 1 ? 1.9 + Math.sin(this.time * 12) : enemy.kind === 'dog' ? 0.8 : 1.15 }
      enemy.attackTimer -= dt
      if (enemy.attackTimer <= 0 && dist < 45) {
        enemy.attackTimer = enemy.kind === 'dog' ? 0.68 : enemy.kind === 'exosuit' ? Math.max(0.48, 1.45 - enemy.phase * 0.28) : 1.12 + Math.random() * 0.7
        this.enemyFire(enemy, target, targetEnemy)
      }
      if (enemy.kind === 'exosuit' && enemy.phase >= 2 && dist < 4 && enemy.attackTimer < 0.2) this.applyDamage(20, pos)
    }
  }
  private enemyFire(enemy: Enemy, target: THREE.Vector3, targetEnemy?: Enemy): void {
    const from = enemy.root.position.clone().add(new THREE.Vector3(0, enemy.kind === 'dog' ? 0.62 : enemy.height * 0.63, 0))
    const to = target.clone().add(new THREE.Vector3(0, 1.15, 0))
    const dir = to.sub(from).normalize()
    const speed = enemy.kind === 'dog' ? 16 : enemy.kind === 'exosuit' ? 20 : 15
    const color = enemy.kind === 'robot' || enemy.kind === 'dog' || enemy.kind === 'exosuit' ? '#ff9851' : '#e9b389'
    const ball = new THREE.Mesh(new THREE.SphereGeometry(enemy.kind === 'exosuit' ? 0.12 : 0.07, 10, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }))
    ball.position.copy(from); this.scene.add(ball)
    this.projectiles.push({ mesh: ball, velocity: dir.multiplyScalar(speed), life: 3.2, owner: 'enemy', damage: enemy.kind === 'exosuit' ? 18 + enemy.phase * 3 : enemy.kind === 'dog' ? 9 : 12, blast: 0, grenade: false, enemyTargetId: targetEnemy?.id })
    this.tracer(from, to, color)
    this.audioCue(enemy.kind === 'robot' || enemy.kind === 'dog' ? 'botFire' : 'enemyFire')
  }
  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.life -= dt; p.velocity.y -= (p.grenade ? 9.2 : 0) * dt; p.mesh.position.addScaledVector(p.velocity, dt)
      if (this.insideCover(p.mesh.position)) {
        if (p.owner === 'player') this.explode(p.mesh.position, p.blast, p.damage, p.selfDamage)
        else this.makeImpact(p.mesh.position, '#e5aa72', 0.34)
        this.removeProjectile(i); continue
      }
      if (p.owner === 'enemy') {
        if (p.enemyTargetId !== undefined) {
          const target = this.enemies.find(e => e.id === p.enemyTargetId && e.alive)
          if (target && p.mesh.position.distanceTo(target.root.position.clone().add(new THREE.Vector3(0, target.height * 0.48, 0))) < (target.kind === 'dog' ? 0.72 : 0.82)) { this.damageBot(target, p.damage); this.removeProjectile(i); continue }
        } else if (p.mesh.position.distanceTo(this.player.position.clone().add(new THREE.Vector3(0, 1.1, 0))) < 0.5) {
          this.applyDamage(p.damage, p.mesh.position); this.removeProjectile(i); continue
        }
      }
      if (p.owner === 'player') {
        const enemy = this.enemies.find(e => e.alive && p.mesh.position.distanceTo(e.root.position.clone().add(new THREE.Vector3(0, e.height * 0.48, 0))) < (e.kind === 'dog' ? 0.72 : e.kind === 'exosuit' ? 1.05 : 0.78))
        if (enemy) { this.explode(p.mesh.position, p.blast, p.damage, p.selfDamage); this.damageEnemy(enemy, p.damage, enemy.kind === 'exosuit' && enemy.phase > 1, this.sliding, !this.player.grounded); this.removeProjectile(i); continue }
        if (p.mesh.position.y < 0.15 || p.life <= 0) { this.explode(p.mesh.position, p.blast, p.damage, p.selfDamage); this.removeProjectile(i); continue }
      }
      if (p.life <= 0) this.removeProjectile(i)
    }
  }
  private removeProjectile(i: number): void { const p = this.projectiles.splice(i, 1)[0]; this.scene.remove(p.mesh); disposeTree(p.mesh) }
  private damageBot(enemy: Enemy, damage: number): void {
    if (!enemy.alive) return
    enemy.hp -= damage
    if (enemy.hp > 0) return
    enemy.hp = 0; enemy.alive = false; enemy.root.visible = false
    window.setTimeout(() => this.scene.remove(enemy.root), 1800)
  }
  private explode(at: THREE.Vector3, radius: number, damage: number, selfDamage = 0): void {
    if (radius <= 0) { this.makeImpact(at, '#f7ac6b', 0.55); return }
    this.fxBurst(at, '#ff8b4c', 40); this.shockwave(at, radius)
    for (const enemy of this.enemies) if (enemy.alive) {
      const d = enemy.root.position.distanceTo(at)
      if (d < radius) this.damageEnemy(enemy, damage * (1 - d / radius * 0.55), false, this.sliding, !this.player.grounded)
    }
    const playerDistance = this.player.position.distanceTo(at)
    if (selfDamage > 0 && playerDistance < radius) this.applyDamage(selfDamage * (1 - playerDistance / radius * 0.55), at)
    this.audioCue('explosion')
  }

  private applyDamage(amount: number, from: THREE.Vector3): void {
    if (this.mode !== 'playing' || this.player.health <= 0) return
    this.armorDelay = 1
    let incoming = amount, broke = false
    const absorbed = Math.min(this.player.armor, incoming)
    this.player.armor -= absorbed; incoming -= absorbed
    if (this.player.armor <= 0 && absorbed > 0) broke = true
    if (incoming > 0) this.player.health = Math.max(0, this.player.health - incoming)
    const direction = Math.atan2(from.x - this.player.position.x, from.z - this.player.position.z) - this.yaw
    this.hooks.hurt(direction, broke); this.audioCue(broke ? 'armorBreak' : 'hurt')
    this.hitStop = Math.max(this.hitStop, 0.026)
  }
  private armorRecharge(dt: number): void { if (this.armorDelay <= 0 && this.player.armor < this.player.maxArmor) this.player.armor = Math.min(this.player.maxArmor, this.player.armor + tuning.value('combat.armorRecharge') * dt) }

  private dropPickup(at: THREE.Vector3): void {
    const r = Math.random()
    const kind: Pickup['kind'] = r < 0.4 ? 'ammo' : r < 0.68 ? 'armor' : 'health'
    const color = kind === 'health' ? '#73e29d' : kind === 'armor' ? '#64c9e8' : '#ffd06a'
    const root = new THREE.Group()
    const core = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, metalness: 0.32, roughness: 0.32 }))
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.035, 8, 18), new THREE.MeshStandardMaterial({ color: '#bdc6c6', metalness: 0.65, roughness: 0.32 }))
    ring.rotation.x = Math.PI / 2; root.add(core, ring); root.position.copy(at).add(new THREE.Vector3(0, 0.55, 0)); root.userData.core = core
    this.scene.add(root); this.pickups.push({ kind, root, age: 0 })
  }
  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i]; p.age += dt; p.root.rotation.y += dt * 1.25; p.root.position.y += Math.sin(p.age * 2.5) * 0.001
      if (p.root.position.distanceTo(this.player.position.clone().add(new THREE.Vector3(0, 0.6, 0))) > 1.15) continue
      if (p.kind === 'health') { this.player.health = Math.min(this.player.maxHealth, this.player.health + 25 * this.pickupBonus); this.hooks.popup('FIELD PATCH', 'pickup') }
      if (p.kind === 'armor') { this.player.armor = Math.min(this.player.maxArmor, this.player.armor + 35 * this.pickupBonus); this.hooks.popup('ARMOR +', 'pickup') }
      if (p.kind === 'ammo') { this.reserve.rifle += Math.round(30 * this.pickupBonus); this.reserve.shotgun += Math.round(8 * this.pickupBonus); this.reserve.launcher += 1; this.reserve.grenade += 1; this.hooks.popup('AMMO CACHE', 'pickup') }
      this.audioCue('pickup'); this.scene.remove(p.root); disposeTree(p.root); this.pickups.splice(i, 1)
    }
  }

  private checkWaveClear(): void {
    const alive = this.enemies.some(e => e.alive)
    if (alive) return
    if (this.match === 'ffa') { this.finish(true); return }
    if (this.run.wave >= 8) { this.finish(true); return }
    if (this.mode !== 'playing') return
    this.mode = 'intermission'; this.hooks.screen('intermission'); this.hooks.banner(`WAVE ${this.run.wave} CLEAR`, 'Choose one field upgrade')
    this.currentAugments = this.rollAugments(); this.hooks.augments(this.run.wave, this.currentAugments)
    void this.warmStage(this.run.wave + 1).catch(() => undefined)
  }
  private rollAugments(): Augment[] { const pool = [...AUGMENTS].sort(() => Math.random() - 0.5); return pool.slice(0, 3) }
  private applyAugment(a: Augment): void {
    this.augmentsOwned.add(a.id)
    if (a.id === 'plates') { this.player.maxArmor += 30; this.player.armor = Math.min(this.player.maxArmor, this.player.armor + 30) }
    else if (a.id === 'feed') this.cadenceBonus += 0.12
    else if (a.id === 'vital') { this.player.maxHealth += 10; this.player.health = Math.min(this.player.maxHealth, this.player.health + 35) }
    else if (a.id === 'optic') this.damageBonus += 0.2
    else if (a.id === 'scav') { this.pickupBonus += 0.2; this.reserve[this.currentWeapon] += WEAPON_META[this.currentWeapon].mag }
    else if (a.id === 'boots') this.moveBonus += 0.08
  }

  private activateOverdrive(): void {
    if (this.overdriveTime > 0 || this.overdriveCharge < 100) return
    this.overdriveCharge = 0; this.overdriveTime = 8; this.hooks.banner('OVERDRIVE', 'Infinite ammunition // accelerated fire'); this.audioCue('overdrive')
  }
  private addStyle(points: number): void {
    const oldRank = Math.min(STYLE_RANKS.length - 1, Math.floor(this.stylePoints / 180))
    this.stylePoints += points; this.styleTimer = 5
    const rank = Math.min(STYLE_RANKS.length - 1, Math.floor(this.stylePoints / 180))
    if (rank > oldRank) this.hooks.popup(`STYLE // ${STYLE_RANKS[rank]}`, 'style')
  }

  private finish(won: boolean): void {
    this.mode = 'ended'; this.run.phase = won ? 'won' : 'lost'; this.hooks.screen('ended')
    this.hooks.ended(won, { kills: this.run.kills, score: this.run.score, wave: this.run.wave, time: this.run.elapsed })
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3, color: string): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()])
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.82, depthWrite: false }))
    line.frustumCulled = false; this.scene.add(line); this.fx.push({ object: line, age: 0, life: 0.075 })
  }
  private makeImpact(p: THREE.Vector3, color: string, size: number): void {
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.055 * size, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false }))
    dot.position.copy(p); dot.lookAt(this.camera.position); this.impacts.add(dot); this.fx.push({ object: dot, age: 0, life: 1.8 })
    this.fxBurst(p, color, Math.round(4 + size * 3))
  }
  private fxBurst(p: THREE.Vector3, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const particle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }))
      particle.position.copy(p); this.scene.add(particle)
      const v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6)
      this.fx.push({ object: particle, age: 0, life: 0.35 + Math.random() * 0.6, update: dt => { particle.position.addScaledVector(v, dt); v.y -= 9 * dt } })
    }
  }
  private flashAt(p: THREE.Vector3, color: string): void {
    const light = new THREE.PointLight(color, 3.5, 6, 2); light.position.copy(p); this.scene.add(light)
    this.fx.push({ object: light, age: 0, life: 0.09 })
  }
  private shockwave(p: THREE.Vector3, radius: number): void {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.055, 8, 42), new THREE.MeshBasicMaterial({ color: '#ffad61', transparent: true, opacity: 0.66 }))
    ring.position.copy(p); ring.rotation.x = Math.PI / 2; this.scene.add(ring)
    this.fx.push({ object: ring, age: 0, life: 0.56, update: dt => { const k = 1 + dt * radius * 2; ring.scale.multiplyScalar(k); (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.66 - ring.scale.x * 0.12) } })
  }
  private shellCasing(): void {
    const at = this.weapons.shellWorld(this.camera)
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 8), new THREE.MeshStandardMaterial({ color: '#b89a59', metalness: 0.7, roughness: 0.26 }))
    shell.position.copy(at); shell.rotation.z = Math.PI / 2; this.scene.add(shell)
    this.audioCue('shell')
    const v = new THREE.Vector3(1.7 + Math.random(), 1.6 + Math.random(), -0.15 + Math.random() * 0.4)
    this.fx.push({ object: shell, age: 0, life: 0.85, update: dt => { shell.position.addScaledVector(v, dt); v.y -= 8 * dt; shell.rotation.x += dt * 16; shell.rotation.z += dt * 9 } })
  }
  private updateFx(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt; f.update?.(dt)
      if (f.object instanceof THREE.Mesh || f.object instanceof THREE.Line) {
        const material = (f.object as THREE.Mesh).material
        for (const m of Array.isArray(material) ? material : [material]) if ('opacity' in m) (m as THREE.Material & { opacity: number }).opacity = Math.min(0.95, Math.max(0, 1 - f.age / f.life))
      }
      if (f.age >= f.life) { this.scene.remove(f.object); disposeTree(f.object); this.fx.splice(i, 1) }
    }
  }
  private makeShadow(): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 2.6), new THREE.MeshBasicMaterial({ color: '#111318', transparent: true, opacity: 0.31, depthWrite: false, side: THREE.DoubleSide }))
    m.rotation.x = -Math.PI / 2; m.renderOrder = 1; return m
  }
  private audioCue(kind: string): void { window.dispatchEvent(new CustomEvent('fps:sound', { detail: kind })) }
}

function makeFallback(kind: EnemyKind): THREE.Group {
  const root = new THREE.Group()
  const armor = new THREE.MeshStandardMaterial({ color: kind === 'robot' ? '#e9e8df' : kind === 'exosuit' ? '#35383a' : kind === 'dog' ? '#353c40' : '#282a2d', metalness: kind === 'robot' || kind === 'exosuit' ? 0.62 : 0.18, roughness: 0.44 })
  const cloth = new THREE.MeshStandardMaterial({ color: '#353331', roughness: 0.82 })
  const amber = new THREE.MeshStandardMaterial({ color: '#e49144', emissive: '#b44e16', emissiveIntensity: 0.8, roughness: 0.36 })
  if (kind === 'dog') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.38, 1.05), armor); body.position.y = 0.48; root.add(body)
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.36, 0.42), armor); head.position.set(0, 0.7, -0.56); root.add(head)
    for (const x of [-0.29, 0.29]) for (const z of [-0.38, 0.35]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.48, 8), armor); leg.position.set(x, 0.22, z); leg.rotation.z = x * 0.3; root.add(leg)
      const paw = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.1, 0.25), cloth); paw.position.set(x, 0.06, z); root.add(paw)
    }
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.13, 12), armor); turret.position.set(0, 0.76, 0.05); root.add(turret)
    const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), amber); sensor.position.set(0, 0.72, -0.79); root.add(sensor)
  } else {
    const h = kind === 'exosuit' ? 2.45 : 1.82, scale = h / 1.82
    const torso = new THREE.Mesh(new THREE.BoxGeometry(kind === 'exosuit' ? 0.9 : 0.58, 0.76 * scale, 0.35), kind === 'exosuit' ? armor : cloth); torso.position.y = h * 0.58; root.add(torso)
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62 * scale, 0.48 * scale, 0.39), armor); vest.position.set(0, h * 0.59, -0.04); root.add(vest)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22 * scale, 14, 10), armor); head.position.y = h * 0.86; root.add(head)
    if (kind === 'wolf' || kind === 'boar') {
      const mask = new THREE.Mesh(new THREE.ConeGeometry(kind === 'boar' ? 0.21 : 0.2, 0.35, 8), armor); mask.position.set(0, h * 0.86, -0.19); mask.rotation.x = -Math.PI / 2; root.add(mask)
      if (kind === 'boar') for (const x of [-0.14, 0.14]) { const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), new THREE.MeshStandardMaterial({ color: '#ded0b5' })); tusk.position.set(x, h * 0.84, -0.34); tusk.rotation.x = Math.PI; root.add(tusk) }
    }
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.1 * scale, 12, 8), amber); chest.position.set(0, h * 0.61, -0.24); root.add(chest)
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.09 * scale, 0.36 * scale, 4, 7), kind === 'exosuit' ? armor : cloth)
      arm.position.set(side * 0.4 * scale, h * 0.62, 0); arm.rotation.z = side * -0.12; root.add(arm)
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.12 * scale, 0.48 * scale, 4, 7), kind === 'exosuit' ? armor : cloth)
      leg.position.set(side * 0.17 * scale, h * 0.18, 0); root.add(leg)
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.19 * scale, 0.14 * scale, 0.27), armor); pad.position.set(side * 0.43 * scale, h * 0.78, 0); root.add(pad)
    }
    if (kind === 'robot') for (const x of [-0.08, 0.08]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.033, 8, 6), amber); eye.position.set(x, h * 0.87, -0.2); root.add(eye) }
  }
  root.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true } })
  return root
}
function addBoarMask(root: THREE.Group): void {
  const muzzle = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 8), new THREE.MeshStandardMaterial({ color: '#76685b', metalness: 0.15, roughness: 0.58 }))
  muzzle.position.set(0, 1.53, -0.17); muzzle.rotation.x = -Math.PI / 2; root.add(muzzle)
  for (const x of [-0.11, 0.11]) { const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 8), new THREE.MeshStandardMaterial({ color: '#ddd2bc' })); tusk.position.set(x, 1.45, -0.22); tusk.rotation.x = Math.PI; root.add(tusk) }
}
function cloneModel(src: THREE.Object3D): THREE.Object3D {
  return cloneSkeleton(src)
}
function normalizeModel(root: THREE.Object3D, targetHeight: number): void {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3())
  if (size.y < 0.01) return
  const s = targetHeight / size.y; root.scale.setScalar(s); root.position.y -= box.min.y * s
}
function disposeTree(root: THREE.Object3D): void {
  root.traverse(o => {
    if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose() }
    if (o instanceof THREE.Line) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; materials.forEach(m => m.dispose()) }
  })
}

function disposeMaterialsOnly(root: THREE.Object3D): void {
  root.traverse(o => {
    if (o instanceof THREE.Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose()
  })
}
