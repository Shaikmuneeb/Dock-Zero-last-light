import type { Action } from '../engine/input'
import type { Augment, GameMode, HudState, MatchMode } from '../game/fps'

export type FpsUiActions = {
  start(mode: MatchMode): void
  retryAssets(): void
  resume(): void
  restart(): void
  quit(): void
  pause(): void
  augment(index: number): void
  retryStage(): void
  settings(values: { quality: 'low' | 'medium' | 'high'; sensitivity: number; musicVolume: number; sfxVolume: number; muted: boolean }): void
  account(): void
  touch(action: Action, down: boolean): void
  uiSound(): void
}

const safe = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export class FpsUI {
  private readonly screens = new Map<string, HTMLElement>()
  private popupToken = 0
  private bannerToken = 0
  private events: Array<() => void> = []
  private currentScreen = 'boot'

  constructor(private readonly root: HTMLElement, private readonly actions: FpsUiActions) {
    root.innerHTML = this.template()
    root.querySelectorAll<HTMLElement>('[data-screen]').forEach(e => this.screens.set(e.dataset.screen!, e))
    this.mountEnhancements()
    const click = (e: Event) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]')
      if (!button) return
      const action = button.dataset.action
      this.actions.uiSound()
      if (action === 'start') this.actions.start((button.dataset.mode === 'ffa' ? 'ffa' : 'survival'))
      else if (action === 'retry-load') this.actions.retryAssets()
      else if (action === 'retry-stage') this.actions.retryStage()
      else if (action === 'account') this.actions.account()
      else if (action === 'resume') this.actions.resume()
      else if (action === 'restart') this.actions.restart()
      else if (action === 'quit') this.actions.quit()
      else if (action === 'pause') this.actions.pause()
      else if (action === 'augment') this.actions.augment(Number(button.dataset.index))
      else if (action === 'settings-open') this.screens.get('settings')?.classList.add('is-active')
      else if (action === 'settings-apply') {
        const quality = root.querySelector<HTMLSelectElement>('[data-setting="quality"]')?.value as 'low' | 'medium' | 'high' | undefined
        const sensitivity = Number(root.querySelector<HTMLInputElement>('[data-setting="sensitivity"]')?.value ?? 1)
        const musicVolume = Number(root.querySelector<HTMLInputElement>('[data-setting="music"]')?.value ?? 0.7)
        const sfxVolume = Number(root.querySelector<HTMLInputElement>('[data-setting="sfx"]')?.value ?? 0.8)
        const muted = !!root.querySelector<HTMLInputElement>('[data-setting="muted"]')?.checked
        this.actions.settings({ quality: quality ?? 'high', sensitivity, musicVolume, sfxVolume, muted })
        this.screens.get('settings')?.classList.remove('is-active')
      } else if (action === 'settings-close') this.screens.get('settings')?.classList.remove('is-active')
    }
    root.addEventListener('click', click)
    this.events.push(() => root.removeEventListener('click', click))
    const down = (e: Event) => {
      const pointer = e as PointerEvent
      const button = (pointer.target as HTMLElement).closest<HTMLButtonElement>('[data-touch]')
      if (!button) return
      pointer.preventDefault(); button.setPointerCapture?.(pointer.pointerId)
      this.actions.touch(button.dataset.touch as Action, true)
    }
    const up = (e: Event) => {
      const pointer = e as PointerEvent
      const button = (pointer.target as HTMLElement).closest<HTMLButtonElement>('[data-touch]')
      if (button) this.actions.touch(button.dataset.touch as Action, false)
      // Safety release after the pointer leaves a touch target or the browser cancels the gesture.
      if (pointer.type === 'pointercancel') root.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(b => this.actions.touch(b.dataset.touch as Action, false))
    }
    root.addEventListener('pointerdown', down, { passive: false })
    root.addEventListener('pointerup', up)
    root.addEventListener('pointercancel', up)
    root.addEventListener('lostpointercapture', up)
    this.events.push(() => { root.removeEventListener('pointerdown', down); root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up); root.removeEventListener('lostpointercapture', up) })
    this.show('boot')
  }

  show(mode: GameMode): void {
    const name = mode === 'title' ? 'title' : mode === 'playing' ? 'hud' : mode === 'paused' ? 'pause' : mode === 'intermission' ? 'intermission' : mode === 'ended' ? 'ended' : 'boot'
    this.currentScreen = name
    for (const [key, screen] of this.screens) screen.classList.toggle('is-active', key === name)
    this.root.dataset.mode = mode
  }

  get settingsOpen(): boolean { return !!this.screens.get('settings')?.classList.contains('is-active') }

  closeSettings(): void { this.screens.get('settings')?.classList.remove('is-active') }

  navigate(direction: -1 | 1): boolean {
    const screen = this.screens.get(this.settingsOpen ? 'settings' : this.currentScreen)
    if (!screen) return false
    const items = [...screen.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')].filter(e => !e.hidden && e.getAttribute('aria-hidden') !== 'true')
    if (!items.length) return false
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = at < 0 ? (direction > 0 ? 0 : items.length - 1) : (at + direction + items.length) % items.length
    items[next].focus({ preventScroll: true })
    this.actions.uiSound()
    return true
  }

  activateFocused(): boolean {
    const screen = this.screens.get(this.settingsOpen ? 'settings' : this.currentScreen)
    if (!screen) return false
    const focused = document.activeElement instanceof HTMLElement && screen.contains(document.activeElement) ? document.activeElement : screen.querySelector<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')
    if (!focused) return false
    focused.click()
    return true
  }

  setArtwork(loadingUrl: string, faviconUrl: string): void {
    const safeLoading = loadingUrl.replace(/["\\\n\r]/g, '')
    const safeIcon = faviconUrl.replace(/["\\\n\r]/g, '')
    this.root.style.setProperty('--title-art', `url("${safeLoading}")`)
    const icon = this.root.querySelector<HTMLImageElement>('.boot-icon')
    if (icon) icon.src = safeIcon
  }

  setModeStatus(status: 'loading' | 'error' | 'ready' | 'idle'): void {
    const label = this.root.querySelector<HTMLElement>('.mode-status')
    const button = this.root.querySelector<HTMLButtonElement>('[data-mode="ffa"]')
    if (label) label.textContent = status === 'loading' ? 'PREPARING FREE-FOR-ALL ASSETS…' : status === 'error' ? 'ARENA ASSETS UNAVAILABLE — SELECT TO RETRY' : ''
    if (button) {
      button.disabled = status === 'loading'
      button.setAttribute('aria-busy', String(status === 'loading'))
      const callout = button.querySelector<HTMLElement>('strong')
      if (callout) callout.innerHTML = status === 'loading' ? 'LOADING ARENA <span>…</span>' : 'ENTER ARENA <span>↗</span>'
    }
  }

  setStageStatus(status: 'loading' | 'ready' | 'error', wave: number): void {
    const label = this.root.querySelector<HTMLElement>('.stage-status')
    const retry = this.root.querySelector<HTMLButtonElement>('.stage-retry')
    const options = this.root.querySelectorAll<HTMLButtonElement>('.augment-card')
    if (label) label.textContent = status === 'loading' ? `PREPARING WAVE ${String(wave).padStart(2, '0')} — LOADING REQUIRED HOSTILE ASSETS` : status === 'ready' ? 'NEXT WAVE READY — CHOOSE YOUR FIELD UPGRADE' : 'ASSET LOAD FAILED — RETRY BEFORE DEPLOYMENT'
    options.forEach(option => { option.disabled = status !== 'ready' })
    if (retry) retry.hidden = status !== 'error'
  }

  setSettings(values: { quality: 'low' | 'medium' | 'high'; sensitivity: number; musicVolume: number; sfxVolume: number; muted: boolean }): void {
    const fields: Array<[string, string]> = [['quality', values.quality], ['sensitivity', String(values.sensitivity)], ['music', String(values.musicVolume)], ['sfx', String(values.sfxVolume)]]
    for (const [name, value] of fields) { const input = this.root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-setting="${name}"]`); if (input) input.value = value }
    const mute = this.root.querySelector<HTMLInputElement>('[data-setting="muted"]'); if (mute) mute.checked = values.muted
  }

  setAccount(status: 'checking' | 'authenticated' | 'logged_out' | 'offline' | 'error', name: string | null = null): void {
    const button = this.root.querySelector<HTMLButtonElement>('.account-chip')
    const note = this.root.querySelector<HTMLElement>('.account-note')
    if (!button || !note) return
    button.textContent = status === 'authenticated' ? `SIGN OUT  /  ${(name || 'OPERATOR').toUpperCase()}` : status === 'offline' ? 'ACCOUNT / OFFLINE PREVIEW' : status === 'checking' ? 'CHECKING ACCOUNT…' : status === 'error' ? 'SIGN-IN UNAVAILABLE' : 'MANUS SIGN-IN'
    button.disabled = status === 'checking'
    note.textContent = status === 'authenticated' ? 'SESSION VERIFIED' : status === 'offline' ? 'Optional account access is available on the online build. Both modes remain playable offline.' : status === 'checking' ? 'VERIFYING SESSION' : status === 'error' ? 'OFFLINE COMBAT READY' : 'OPTIONAL · DOES NOT AFFECT OFFLINE PLAY'
  }

  setAccountNotice(message: string): void { const note = this.root.querySelector<HTMLElement>('.account-note'); if (note) note.textContent = message }

  setBootError(): void {
    this.setBootProgress(0, 'FIRST-WAVE ASSETS UNAVAILABLE — RETRY')
    const button = this.root.querySelector<HTMLButtonElement>('.boot-retry')
    if (button) button.hidden = false
  }

  clearBootError(): void { const button = this.root.querySelector<HTMLButtonElement>('.boot-retry'); if (button) button.hidden = true }

  setBootProgress(value: number, label = 'LOADING FIRST WAVE'): void {
    const pct = Math.max(0, Math.min(1, value)) * 100
    const bar = this.root.querySelector<HTMLElement>('.boot-progress i')
    if (bar) bar.style.width = `${pct}%`
    const text = this.root.querySelector<HTMLElement>('.boot-label')
    if (text) text.textContent = label
  }

  update(state: HudState): void {
    const set = (key: string, value: string | number) => { const el = this.root.querySelector<HTMLElement>(`[data-hud="${key}"]`); if (el) el.textContent = String(value) }
    const bar = (key: string, value: number, max = 100) => { const el = this.root.querySelector<HTMLElement>(`[data-bar="${key}"]`); if (el) el.style.width = `${Math.max(0, Math.min(100, value / max * 100))}%` }
    set('wave', String(state.wave).padStart(2, '0')); set('score', state.score.toLocaleString('en-US')); set('kills', String(state.kills))
    set('health', Math.ceil(state.health)); set('armor', Math.ceil(state.armor)); set('ammo', state.ammo); set('reserve', state.reserve)
    set('weapon', state.weaponName); set('style', state.style); set('stylepoints', `${state.stylePoints} STYLE`)
    set('time', formatTime(state.time)); set('alive', state.botsAlive)
    bar('health', state.health, state.maxHealth); bar('armor', state.armor, state.maxArmor)
    bar('overdrive', state.overdrive, 1); bar('boss', state.bossHp, 1)
    const overdrive = this.root.querySelector<HTMLElement>('[data-hud="overdrive-value"]')
    if (overdrive) overdrive.textContent = state.overdriveActive ? `${Math.ceil(state.overdrive * 8)} SEC` : state.overdrive >= 1 ? 'READY' : 'CHARGING'
    const recharge = this.root.querySelector<HTMLElement>('.armor-recharge')
    if (recharge) { recharge.textContent = state.armorRecharging ? 'RECHARGING / 55 PER SEC' : 'AUTO-RECHARGE / 55 PER SEC'; recharge.classList.toggle('is-recharging', state.armorRecharging) }
    const bossbar = this.root.querySelector<HTMLElement>('.boss-hud'); bossbar?.classList.toggle('is-visible', state.boss)
    set('bossphase', `PHASE ${state.bossPhase}`)
    const waveLabel = this.root.querySelector<HTMLElement>('.mode-value'); if (waveLabel) waveLabel.textContent = state.match === 'ffa' ? 'FREE FOR ALL' : 'LAST LIGHT'
    const aliveBadge = this.root.querySelector<HTMLElement>('.ffa-alive'); aliveBadge?.classList.toggle('is-visible', state.match === 'ffa');
    this.root.classList.toggle('is-critical', state.health < 28)
    this.root.classList.toggle('is-aiming', state.aiming)
  }

  showAugments(wave: number, options: Augment[]): void {
    const wrap = this.root.querySelector<HTMLElement>('.augment-grid')
    if (wrap) wrap.innerHTML = options.map((a, i) => `<button class="augment-card" data-action="augment" data-index="${i}"><span class="augment-number">0${i + 1} / STACKABLE</span><strong>${safe(a.title)}</strong><span>${safe(a.description)}</span><i>SELECT UPGRADE →</i></button>`).join('')
    const label = this.root.querySelector<HTMLElement>('.augment-wave'); if (label) label.textContent = `WAVE ${String(wave).padStart(2, '0')} COMPLETE`
    this.setStageStatus('loading', wave + 1)
  }

  showEnd(won: boolean, stats: { kills: number; score: number; wave: number; time: number }): void {
    const title = this.root.querySelector<HTMLElement>('.end-title'); if (title) title.textContent = won ? 'TERMINAL SECURED' : 'OPERATOR DOWN'
    const text = this.root.querySelector<HTMLElement>('.end-copy'); if (text) text.textContent = won ? 'The harbor falls quiet. For now.' : 'The terminal is still out there.'
    const stat = this.root.querySelector<HTMLElement>('.end-stats');
    if (stat) stat.innerHTML = `<span><b>${stats.kills}</b>KILLS</span><span><b>${stats.score.toLocaleString('en-US')}</b>SCORE</span><span><b>${stats.wave}/8</b>WAVE</span><span><b>${formatTime(stats.time)}</b>TIME</span>`
  }

  banner(title: string, detail = ''): void {
    const el = this.root.querySelector<HTMLElement>('.combat-banner'); if (!el) return
    const h = el.querySelector('strong'), p = el.querySelector('span'); if (h) h.textContent = title; if (p) p.textContent = detail
    el.classList.add('is-visible'); const token = ++this.bannerToken
    window.setTimeout(() => { if (token === this.bannerToken) el.classList.remove('is-visible') }, 2300)
  }

  popup(text: string, kind: string = 'kill'): void {
    const host = this.root.querySelector<HTMLElement>('.combat-popups'); if (!host) return
    const n = document.createElement('div'); n.className = `combat-popup popup-${safe(kind)}`; n.textContent = text; host.append(n)
    const token = ++this.popupToken; window.setTimeout(() => { n.remove(); void token }, 1650)
  }

  hurt(direction: number, armorBreak: boolean): void {
    this.root.classList.add('taking-hit')
    const vignette = this.root.querySelector<HTMLElement>('.damage-vignette')
    if (vignette) vignette.style.setProperty('--hurt', '0.54')
    const angle = ((direction * 180 / Math.PI) % 360 + 360) % 360
    const sector = Math.round(angle / 90) % 4
    const arcs = this.root.querySelectorAll<HTMLElement>('.damage-arrow')
    arcs.forEach((a, i) => a.classList.toggle('is-hit', i === sector))
    if (armorBreak) this.popup('ARMOR BREAK', 'damage')
    window.setTimeout(() => { this.root.classList.remove('taking-hit'); arcs.forEach(a => a.classList.remove('is-hit')); if (vignette) vignette.style.setProperty('--hurt', '0') }, 440)
  }

  destroy(): void { this.events.forEach(off => off()); this.events = [] }

  private mountEnhancements(): void {
    const boot = this.screens.get('boot')
    if (boot) {
      const retry = document.createElement('button')
      retry.className = 'boot-retry'; retry.dataset.action = 'retry-load'; retry.textContent = 'RETRY ASSET LOAD'; retry.hidden = true
      boot.append(retry)
    }
    const title = this.screens.get('title')
    if (title) {
      const account = document.createElement('aside'); account.className = 'account-panel'
      const button = document.createElement('button'); button.type = 'button'; button.className = 'account-chip'; button.dataset.action = 'account'
      const note = document.createElement('span'); note.className = 'account-note'
      account.append(button, note); title.append(account)
      this.setAccount('checking')
    }
    const card = this.root.querySelector<HTMLElement>('.settings-card')
    if (card) {
      for (const [key, title, initial] of [['music', 'MUSIC VOLUME', '0.7'], ['sfx', 'SFX VOLUME', '0.8']] as const) {
        const label = document.createElement('label'); label.className = 'audio-setting'; label.textContent = title
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.05'; slider.value = initial; slider.dataset.setting = key
        label.append(slider); card.insertBefore(label, card.querySelector('[data-action="settings-apply"]'))
      }
      const mutedLabel = document.createElement('label'); mutedLabel.className = 'mute-setting'; mutedLabel.textContent = 'MUTE ALL AUDIO'
      const mute = document.createElement('input'); mute.type = 'checkbox'; mute.dataset.setting = 'muted'; mutedLabel.append(mute)
      card.insertBefore(mutedLabel, card.querySelector('[data-action="settings-apply"]'))
    }
    this.root.querySelector('.touch-controls')?.classList.add('touch')
  }

  private template(): string {
    return /* html */ `
<section class="screen boot-screen is-active" data-screen="boot"><div class="boot-mark"><i></i><span>DOCK ZERO / OPERATIONAL SYSTEM</span></div><img class="boot-icon" alt="Dock Zero harbor shield" /><div class="boot-copy"><b>Loading terminal assets</b><span class="boot-label">LOADING FIRST WAVE</span></div><div class="boot-progress"><i></i></div><div class="boot-code">SECURE LINK // OFFLINE COMBAT SYSTEMS</div></section>
<section class="screen title-screen" data-screen="title"><div class="title-backdrop"></div><div class="title-grain"></div><div class="title-side"><span class="eyebrow">HARBOR DEFENSE DIVISION&nbsp; / &nbsp;SECTOR 09</span><div class="title-logo"><span class="logo-mark"><i></i><i></i><i></i></span><div><h1>DOCK ZERO</h1><h2>LAST <em>LIGHT</em></h2></div></div><p class="title-subtitle">The port went dark at 19:42.<br>You're the last signal still moving.</p><div class="mode-select"><button class="launch-card" data-action="start" data-mode="survival"><span>01 / SURVIVAL</span><b>HOLD THE LINE</b><i>Eight waves · Three-phase exosuit</i><strong>DEPLOY <span>↗</span></strong></button><button class="launch-card launch-card-quiet" data-action="start" data-mode="ffa"><span>02 / FREE FOR ALL</span><b>NO FRIENDLIES</b><i>Six offline combat bots · Every target hostile</i><strong>ENTER ARENA <span>↗</span></strong></button></div><div class="mode-status" aria-live="polite"></div><div class="title-controls"><b>FIELD CONTROLS</b><span>WASD move &nbsp;·&nbsp; mouse aim &nbsp;·&nbsp; LMB fire &nbsp;·&nbsp; RMB optic</span><span>Q quick-switch &nbsp;·&nbsp; Shift sprint &nbsp;·&nbsp; hold C crouch &nbsp;·&nbsp; sprint + C slide &nbsp;·&nbsp; Space jump</span><span>1–4 weapons &nbsp;·&nbsp; R reload &nbsp;·&nbsp; G grenade &nbsp;·&nbsp; V melee &nbsp;·&nbsp; X overdrive</span><span>Controller: Left stick move · Right stick aim · RT fire · LT optic · A jump · Start pause</span></div><div class="title-footer"><span>OFFLINE CAMPAIGN // V.09.17</span><span>Built for landscape · Keyboard · Controller · Touch</span></div></div><div class="title-right"><div class="dispatch"><span class="dispatch-dot"></span><span>LAST TRANSMISSION</span><b>“They brought a machine<br>that walks through steel.”</b><small>— PIER COMMAND / 00:14:06</small></div><div class="sound-meter"><span>TACTICAL CHANNEL OPEN</span><i><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b></i></div></div></section>
<section class="screen hud-screen" data-screen="hud"><div class="hud-scan"></div><div class="damage-vignette"></div><div class="damage-arrow arrow-top"></div><div class="damage-arrow arrow-right"></div><div class="damage-arrow arrow-bottom"></div><div class="damage-arrow arrow-left"></div><div class="hud-top"><div class="hud-mark"><i class="hud-sigil"></i><div><span>DOCK ZERO // SECTOR 09</span><b class="mode-value">LAST LIGHT</b></div></div><div class="wave-block"><span>WAVE</span><b data-hud="wave">01</b><small data-hud="time">00:00</small></div><div class="score-block"><span>COMBAT SCORE</span><b data-hud="score">000000</b><small><i></i> KILLS <b data-hud="kills">0</b></small></div><div class="ffa-alive"><span>COMBATANTS</span><b data-hud="alive">7</b><small>LEFT</small></div><button class="pause-hud" data-action="pause" aria-label="Pause">Ⅱ</button></div><div class="vital-block"><div class="vital-row"><span>VITALS</span><b data-hud="health">100</b></div><div class="meter"><i data-bar="health"></i></div><div class="vital-row armor-row"><span>PLATE / <b>150</b></span><b data-hud="armor">150</b></div><div class="meter armor-meter"><i data-bar="armor"></i></div><span class="armor-recharge">AUTO-RECHARGE / 55 PER SEC</span></div><div class="boss-hud"><div class="boss-label"><span>HOSTILE EXOSKELETON</span><b data-hud="bossphase">PHASE 1</b></div><div class="meter boss-meter"><i data-bar="boss"></i></div><small>EXPOSED CORE // CENTER MASS</small></div><div class="combat-banner"><strong></strong><span></span></div><div class="combat-popups"></div><div class="style-block"><span>STYLE RANK</span><b data-hud="style">ROOKIE</b><small data-hud="stylepoints">0 STYLE</small></div><div class="weapon-block"><span class="weapon-serial">DZ / 09 — ISSUE</span><b data-hud="weapon">KESTREL AR</b><div class="ammo-line"><strong data-hud="ammo">30</strong><i>/</i><span data-hud="reserve">180</span></div><small>R RELOAD &nbsp;·&nbsp; Q SWAP &nbsp;·&nbsp; 1–4 SELECT</small></div><div class="overdrive-block"><div><span>OVERDRIVE</span><b data-hud="overdrive-value">READY</b></div><div class="meter overdrive-meter"><i data-bar="overdrive"></i></div><small>X ACTIVATE &nbsp;·&nbsp; 8 SEC / INFINITE AMMO</small></div><div class="combat-prompt">MOVE <b>W A S D</b><i>·</i> AIM <b>MOUSE</b><i>·</i> FIRE <b>LMB</b><i>·</i> OPTIC <b>RMB</b><i>·</i> PAUSE <b>ESC</b></div><div class="touch-zone touch-look" aria-hidden="true"></div><div class="touch-controls"><div class="touch-stick" aria-label="Move"><i></i></div><div class="touch-actions"><button data-touch="fire">FIRE</button><button data-touch="aim">AIM</button><button data-touch="jump">JUMP</button><button data-touch="sprint">RUN</button><button data-touch="crouch">CROUCH</button><button data-touch="reload">RELOAD</button><button data-touch="grenade">GRENADE</button><button data-touch="melee">MELEE</button><button data-touch="weaponNext">SWAP</button><button data-touch="overdrive">OVERDRIVE</button></div></div><div class="rotate-notice">ROTATE DEVICE TO LANDSCAPE</div></section>
<section class="screen pause-screen" data-screen="pause"><div class="modal-veil"></div><div class="pause-card"><div class="pause-emblem">DZ<span>//</span>09</div><span class="eyebrow">COMBAT PAUSED / WORLD AUDIO MUTED</span><h2>REGROUP.</h2><p>Take a breath. The terminal can wait.</p><button class="menu-primary" data-action="resume">RESUME OPERATION <span>↗</span></button><button class="menu-secondary" data-action="restart">RESTART RUN</button><button class="menu-secondary" data-action="settings-open">FIELD SETTINGS</button><button class="menu-secondary" data-action="quit">RETURN TO TITLE</button><div class="pause-foot">ESC TO RESUME &nbsp; / &nbsp; ALL HOSTILES ON HOLD</div></div></section>
<section class="screen settings-screen" data-screen="settings"><div class="modal-veil"></div><div class="settings-card"><span class="eyebrow">FIELD CONFIGURATION</span><h2>SETTINGS</h2><label>RENDER QUALITY<select data-setting="quality"><option value="low">LOW / MOBILE</option><option value="medium">MEDIUM</option><option value="high">HIGH / DESKTOP</option></select></label><label>AIM SENSITIVITY<input data-setting="sensitivity" type="range" min="0.5" max="2" step="0.1" value="1"></label><button class="menu-primary" data-action="settings-apply">APPLY & RETURN</button><button class="menu-secondary" data-action="settings-close">CANCEL</button></div></section>
<section class="screen intermission-screen" data-screen="intermission"><div class="intermission-bg"></div><div class="intermission-panel"><span class="eyebrow augment-wave">WAVE 01 COMPLETE</span><h2>RE-FIT YOUR KIT.</h2><p>One upgrade. Stacks permanently for this run.</p><div class="stage-status" aria-live="polite">PREPARING NEXT WAVE</div><div class="augment-grid"></div><button class="stage-retry" data-action="retry-stage" hidden>RETRY NEXT-WAVE ASSETS</button><div class="intermission-tip">UPGRADES ARE FIELD-TESTED. CHOOSE WISELY.</div></div></section>
<section class="screen end-screen" data-screen="ended"><div class="end-card"><span class="eyebrow">DOCK ZERO // AFTER-ACTION REPORT</span><h2 class="end-title">OPERATOR DOWN</h2><p class="end-copy"></p><div class="end-stats"></div><button class="menu-primary" data-action="restart">DEPLOY AGAIN <span>↗</span></button><button class="menu-secondary" data-action="quit">RETURN TO TITLE</button><div class="end-foot">THE HARBOR REMEMBERS.</div></div></section>`
  }
}

function formatTime(time: number): string {
  const seconds = Math.max(0, Math.floor(time)); const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
