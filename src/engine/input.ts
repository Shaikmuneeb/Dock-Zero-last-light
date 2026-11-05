/**
 * Unified FPS input: keyboard/mouse, gamepad and touch feed one action state.
 * Camera look is accumulated in radians-ish units and consumed once per render frame.
 */
export type Action =
  | 'jump' | 'sprint' | 'dash' | 'pause' | 'confirm' | 'back' | 'interact' | 'menuNext' | 'menuPrev'
  | 'fire' | 'aim' | 'reload' | 'crouch' | 'grenade' | 'melee' | 'weaponNext'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'overdrive'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Partial<Record<Action, string[]>> = {
  jump: ['Space'], sprint: ['ShiftLeft', 'ShiftRight'], dash: ['KeyF'], pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'], back: ['Backspace'], interact: ['KeyE'], reload: ['KeyR'],
  menuNext: ['ArrowDown', 'ArrowRight'], menuPrev: ['ArrowUp', 'ArrowLeft'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'], grenade: ['KeyG'], melee: ['KeyV'], weaponNext: ['KeyQ'],
  weapon1: ['Digit1'], weapon2: ['Digit2'], weapon3: ['Digit3'], weapon4: ['Digit4'], overdrive: ['KeyX'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standard mapping: A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, Start=9, L3=10.
const PAD_BINDINGS: Partial<Record<Action, number[]>> = {
  jump: [0], sprint: [10], dash: [4], pause: [9], confirm: [0], back: [1], reload: [2], melee: [1],
  menuNext: [12, 15], menuPrev: [13, 14],
  aim: [6], fire: [7], crouch: [11], grenade: [8], weaponNext: [5], weapon1: [14], weapon2: [15],
  weapon3: [12], weapon4: [13], overdrive: [3],
}

export class Input {
  readonly move = { x: 0, y: 0 }
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  sensitivity = 1
  invertY = false

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private mouseButtons = new Set<number>()
  private mousePoint = { x: 0, y: 0 }
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev: boolean[] = []
  private padIndex = -1
  private padId = ''
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes?.includes(e.code)) this.pressed_.add(action)
      }
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (!typing && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => { this.keys.clear(); this.mouseButtons.clear() })
    on(window, 'gamepaddisconnected', e => { if (e.gamepad.index === this.padIndex) this.resetPad() })
    on(window, 'mousedown', e => {
      if (document.pointerLockElement !== canvas && e.target !== canvas) return
      this.method = 'keyboard'
      this.mouseButtons.add(e.button)
      this.mousePoint.x = e.clientX; this.mousePoint.y = e.clientY
      if (e.button === 0) this.pressed_.add('fire')
      if (e.button === 2) this.pressed_.add('aim')
    })
    on(window, 'mouseup', e => this.mouseButtons.delete(e.button))
    on(window, 'mousemove', e => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX * 0.0022
        this.look.y += e.movementY * 0.0022
      } else {
        const dx = e.clientX - this.mousePoint.x, dy = e.clientY - this.mousePoint.y
        this.mousePoint.x = e.clientX; this.mousePoint.y = e.clientY
        if (this.mouseButtons.has(2)) { this.look.x += dx * 0.0022; this.look.y += dy * 0.0022 }
      }
    })
    on(window, 'contextmenu', e => { if (e.target === canvas) e.preventDefault() })
    on(window, 'wheel', () => { if (document.pointerLockElement === canvas) this.pressed_.add('weaponNext') }, { passive: true })
    const onPointerLockChange = () => { if (document.pointerLockElement !== canvas) this.mouseButtons.clear() }
    const lockTarget = typeof document.addEventListener === 'function' ? document : window
    lockTarget.addEventListener('pointerlockchange', onPointerLockChange as EventListener)
    this.listeners.push(() => lockTarget.removeEventListener('pointerlockchange', onPointerLockChange as EventListener))
  }

  lockPointer(): void {
    const touchDevice = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
    if (!touchDevice && this.method !== 'touch' && document.pointerLockElement !== this.canvas) {
      try { void this.canvas.requestPointerLock?.()?.catch?.(() => undefined) } catch { /* keyboard/gamepad can play without pointer lock */ }
    }
  }
  unlockPointer(): void { if (document.pointerLockElement) document.exitPointerLock() }
  setTouchMove(x: number, y: number): void { this.method = 'touch'; this.touchMove.x = x; this.touchMove.y = y }
  addTouchLook(dx: number, dy: number): void { this.method = 'touch'; this.look.x += dx * 0.006; this.look.y += dy * 0.006 }
  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action); else this.touchButtons.delete(action)
  }

  private resetPad(): void { this.padPrev = []; this.padIndex = -1; this.padId = '' }

  update(frameSeconds = 1 / 60): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) if (codes && k(codes)) this.held_.add(action)
    if (this.mouseButtons.has(0)) this.held_.add('fire')
    if (this.mouseButtons.has(2)) this.held_.add('aim')
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) { x = this.touchMove.x; y = this.touchMove.y }

    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      if (pad.index !== this.padIndex || pad.id !== this.padId) this.padPrev = []
      this.padIndex = pad.index; this.padId = pad.id
      const dead = (v: number) => Math.abs(v) < 0.18 ? 0 : v
      const lx = dead(pad.axes[0] ?? 0), ly = dead(pad.axes[1] ?? 0), rx = dead(pad.axes[2] ?? 0), ry = dead(pad.axes[3] ?? 0)
      const padActive = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0)
      const dy = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0)
      if (lx !== 0 || ly !== 0 || dx !== 0 || dy !== 0) { x = dx || lx; y = dy || -ly }
      this.look.x += rx * 2.7 * frameSeconds; this.look.y += ry * 2.7 * frameSeconds
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (!buttons) continue
        if (buttons.some(i => (pad.buttons[i]?.value ?? 0) > 0.45)) this.held_.add(action)
        if (buttons.some(i => pad.buttons[i]?.pressed && !this.padPrev[i])) this.pressed_.add(action)
      }
      this.padPrev = pad.buttons.map(b => b.pressed)
    } else this.resetPad()
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x; this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean { return this.held_.has(action) }
  pressed(action: Action): boolean { return this.pressed_.has(action) }
  consume(action: Action): boolean { return this.pressed_.delete(action) }
  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0; this.look.y = 0; return out
  }
  endFrame(): void { this.pressed_.clear() }
  dispose(): void { for (const off of this.listeners) off(); this.listeners = [] }
}
