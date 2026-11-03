import { afterEach, describe, expect, it } from 'vitest'
import { tuning } from '../src/game/tuning'

const defaults = Object.fromEntries(tuning.controls.map(control => [control.id, control.default]))
afterEach(() => {
  tuning.apply(defaults)
  tuning.activate('run')
})

describe('Dock Zero FPS tuning', () => {
  it('retains the requested player damage and armor defaults', () => {
    expect(tuning.value('combat.playerDamage')).toBe(1)
    expect(tuning.value('combat.armorRecharge')).toBe(55)
    expect(tuning.value('camera.rifleFov')).toBeLessThan(tuning.value('camera.hipFov'))
    expect(tuning.value('camera.shotgunFov')).toBeLessThan(tuning.value('camera.hipFov'))
  })

  it('validates the complete patch atomically, with ranges, steps and FOV/speed relationships', () => {
    const before = tuning.read()
    for (const patch of [
      { 'player.walkSpeed': 8.2 },
      { 'player.walkSpeed': 8, 'player.sprintSpeed': 7 },
      { 'camera.rifleFov': 75 },
      { 'combat.armorRecharge': 56 },
      { unexpected: 1 },
    ]) {
      expect(() => tuning.apply(patch)).toThrow()
      expect(tuning.read()).toEqual(before)
    }
  })

  it('applies cosmetic optic/camera changes live without changing the default catalog', () => {
    const defaultsBefore = tuning.controls.map(control => [control.id, control.default])
    tuning.apply({ 'camera.hipFov': 90, 'camera.rifleFov': 48, 'camera.shotgunFov': 57 })
    expect(tuning.value('camera.hipFov')).toBe(90)
    expect(tuning.value('camera.rifleFov')).toBe(48)
    expect(tuning.value('camera.shotgunFov')).toBe(57)
    expect(tuning.controls.map(control => [control.id, control.default])).toEqual(defaultsBefore)
    expect(tuning.unranked).toBe(false)
  })

  it('holds gameplay changes until a new run and latches the requested unranked guard', () => {
    const oldSpeed = tuning.value('player.walkSpeed')
    tuning.apply({ 'player.walkSpeed': 6, 'combat.enemyHealth': 1.1 })
    expect(tuning.value('player.walkSpeed')).toBe(oldSpeed)
    expect(tuning.unranked).toBe(true)
    tuning.activate('run')
    expect(tuning.value('player.walkSpeed')).toBe(6)
    expect(tuning.value('combat.enemyHealth')).toBe(1.1)
    expect(tuning.unranked).toBe(true)
  })
})
