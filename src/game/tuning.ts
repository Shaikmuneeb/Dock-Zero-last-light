type ApplyMode = 'LIVE' | 'NEXT_RUN'
type Parameter = { id: string; type: 'number'; category: string; label: string; description: string; unit: string; default: number; min: number; max: number; step: number; applyMode: ApplyMode; integrity: 'COSMETIC' | 'GAMEPLAY' }

type ParameterId = 'player.walkSpeed' | 'player.sprintSpeed' | 'player.slideSpeed' | 'player.jumpSpeed' | 'combat.playerDamage' | 'combat.enemyHealth' | 'combat.armorRecharge' | 'camera.hipFov' | 'camera.rifleFov' | 'camera.shotgunFov'

const parameters: Parameter[] = [
  { id: 'player.walkSpeed', type: 'number', category: 'Movement', label: 'Walking speed', description: 'Ground movement speed when not sprinting.', unit: 'm/s', default: 5.25, min: 3.5, max: 8, step: 0.25, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'player.sprintSpeed', type: 'number', category: 'Movement', label: 'Sprint speed', description: 'Maximum speed while sprinting.', unit: 'm/s', default: 8.9, min: 6, max: 12, step: 0.1, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'player.slideSpeed', type: 'number', category: 'Movement', label: 'Slide speed', description: 'Speed retained through a tactical slide.', unit: 'm/s', default: 12.4, min: 8, max: 16, step: 0.2, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'player.jumpSpeed', type: 'number', category: 'Movement', label: 'Jump impulse', description: 'Vertical launch speed when the next run starts.', unit: 'm/s', default: 7.5, min: 5, max: 10, step: 0.25, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'combat.playerDamage', type: 'number', category: 'Combat', label: 'Player attack scale', description: 'Scales all player weapon damage on top of the requested 1.25× baseline.', unit: '×', default: 1, min: 0.8, max: 1.5, step: 0.05, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'combat.enemyHealth', type: 'number', category: 'Combat', label: 'Enemy health scale', description: 'Scales enemy health for the next run; enemy damage is unchanged.', unit: '×', default: 1, min: 0.7, max: 1.4, step: 0.05, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'combat.armorRecharge', type: 'number', category: 'Combat', label: 'Armor recharge rate', description: 'Armor restored per second after one second without damage.', unit: '/s', default: 55, min: 25, max: 80, step: 5, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'camera.hipFov', type: 'number', category: 'Camera', label: 'Field of view', description: 'Horizontal-free vertical field of view while not aiming.', unit: '°', default: 74, min: 65, max: 95, step: 1, applyMode: 'LIVE', integrity: 'COSMETIC' },
  { id: 'camera.rifleFov', type: 'number', category: 'Camera', label: 'Rifle optic field of view', description: 'Field of view through the physical red-dot optic.', unit: '°', default: 43, min: 32, max: 60, step: 1, applyMode: 'LIVE', integrity: 'COSMETIC' },
  { id: 'camera.shotgunFov', type: 'number', category: 'Camera', label: 'Shotgun iron-sight field of view', description: 'Field of view aligned with the shotgun iron sights.', unit: '°', default: 50, min: 40, max: 68, step: 1, applyMode: 'LIVE', integrity: 'COSMETIC' },
]

const byId = new Map(parameters.map(parameter => [parameter.id, parameter]))
const defaults = Object.fromEntries(parameters.map(parameter => [parameter.id, parameter.default])) as Record<ParameterId, number>
let requested: Record<ParameterId, number> = { ...defaults }
let active: Record<ParameterId, number> = { ...defaults }
let unranked = false

function validate(candidate: Record<ParameterId, number>): void {
  if (candidate['player.walkSpeed'] > candidate['player.sprintSpeed']) throw new Error('Walking speed cannot exceed sprint speed')
  if (candidate['camera.rifleFov'] >= candidate['camera.hipFov'] || candidate['camera.shotgunFov'] >= candidate['camera.hipFov']) throw new Error('Aiming FOV must be narrower than hip FOV')
}

const gameplayModified = () => parameters.some(parameter => parameter.integrity === 'GAMEPLAY' && requested[parameter.id as ParameterId] !== parameter.default)

export const tuning = {
  get unranked(): boolean { return unranked },
  controls: Object.freeze(parameters),
  value(id: ParameterId): number { return active[id] },
  read() { return { requested: { ...requested }, active: { ...active } } },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > parameters.length) throw new Error('Invalid patch')
    const next = { ...requested }
    for (const [id, value] of entries) {
      const parameter = byId.get(id as ParameterId)
      if (!parameter || typeof value !== 'number' || !Number.isFinite(value) || value < parameter.min || value > parameter.max) throw new Error('Invalid value')
      const step = (value - parameter.min) / parameter.step
      if (Math.abs(step - Math.round(step)) > 1e-7) throw new Error('Invalid increment')
      next[id as ParameterId] = value
    }
    validate(next)
    requested = next
    for (const [id] of entries) {
      const parameter = byId.get(id as ParameterId)!
      if (parameter.applyMode === 'LIVE') active[id as ParameterId] = requested[id as ParameterId]
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: 'run'): void {
    active = { ...requested }
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
