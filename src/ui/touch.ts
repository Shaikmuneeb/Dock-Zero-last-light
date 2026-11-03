import type { Input } from '../engine/input'

/**
 * On-screen touch controls: a floating stick on the left half, drag-to-look on the right half,
 * and on-screen combat buttons. Enabled automatically on the first touch.
 */
export class TouchControls {
  private stickId: number | null = null
  private lookId: number | null = null
  private origin = { x: 0, y: 0 }
  private last = { x: 0, y: 0 }
  private readonly stick: HTMLElement
  private readonly knob: HTMLElement

  constructor(root: HTMLElement, private readonly input: Input, private readonly active: () => boolean) {
    const layer = root.querySelector<HTMLElement>('.touch')!
    this.stick = layer.querySelector('.touch-stick')!
    this.knob = this.stick.querySelector('i')!
    const radius = 56

    const enable = () => document.body.classList.add('has-touch')
    if (matchMedia('(pointer: coarse)').matches) enable()
    window.addEventListener('touchstart', enable, { once: true, passive: true })
    // Any touch switches hints/prompts to touch, even taps on menu buttons.
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') this.input.method = 'touch'
    }, { capture: true })

    const canvas = document.querySelector<HTMLCanvasElement>('#game')!
    const begin = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !this.active()) return
      const target = e.target as HTMLElement
      if (target.closest('[data-touch]')) return
      if (target !== canvas && !target.closest('.touch-stick') && !target.closest('.touch-look')) return
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* window listeners still handle uncaptured pointers */ }
      if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
        this.stickId = e.pointerId
        this.origin = { x: e.clientX, y: e.clientY }
        this.stick.style.left = `${e.clientX - radius}px`
        this.stick.style.top = `${e.clientY - radius}px`
        this.stick.classList.add('is-active')
      } else if (this.lookId === null) {
        this.lookId = e.pointerId
        this.last = { x: e.clientX, y: e.clientY }
      }
    }
    root.addEventListener('pointerdown', begin)
    canvas.addEventListener('pointerdown', begin)
    window.addEventListener('pointermove', e => {
      if (e.pointerId === this.stickId) {
        let dx = e.clientX - this.origin.x
        let dy = e.clientY - this.origin.y
        const len = Math.hypot(dx, dy)
        if (len > radius) {
          dx = (dx / len) * radius
          dy = (dy / len) * radius
        }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`
        this.input.setTouchMove(dx / radius, -dy / radius)
      } else if (e.pointerId === this.lookId) {
        this.input.addTouchLook(e.clientX - this.last.x, e.clientY - this.last.y)
        this.last = { x: e.clientX, y: e.clientY }
      }
    })
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) {
        this.stickId = null
        this.knob.style.transform = ''
        this.stick.classList.remove('is-active')
        this.stick.style.left = ''; this.stick.style.top = ''
        this.input.setTouchMove(0, 0)
      }
      if (e.pointerId === this.lookId) this.lookId = null
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)

    for (const btn of layer.querySelectorAll<HTMLElement>('[data-touch]')) {
      const action = btn.dataset.touch as 'jump' | 'dash'
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        btn.setPointerCapture(e.pointerId)
        btn.classList.add('is-down')
        this.input.setTouchButton(action, true)
      })
      const up = () => {
        btn.classList.remove('is-down')
        this.input.setTouchButton(action, false)
      }
      btn.addEventListener('pointerup', up)
      btn.addEventListener('pointercancel', up)
    }
  }
}
