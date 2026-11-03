import './styles/main.css'
import { ManusAuth, type ManusSession } from '../manus-auth.js'
import { registerGameTuning } from '../scripts/manus-tuning/adapter.js'
import { Audio, type MusicMode } from './engine/audio'
import { GameLoop } from './engine/loop'
import { Input } from './engine/input'
import { Renderer, suggestQuality } from './engine/renderer'
import { SAVE_KEY, SaveStore, type Quality } from './engine/save'
import { FpsGame, type GameMode, type MatchMode } from './game/fps'
import { GAME_ART_URLS } from './game/fps-assets'
import { tuning } from './game/tuning'
import { FpsUI } from './ui/fps-ui'
import { TouchControls } from './ui/touch'

function safeGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

async function boot(): Promise<void> {
  document.documentElement.lang = 'en'
  const app = document.querySelector<HTMLElement>('#app')
  const canvas = document.querySelector<HTMLCanvasElement>('#game')
  const root = document.querySelector<HTMLElement>('#ui')
  if (!app || !canvas || !root) throw new Error('Dock Zero could not mount its game canvas.')

  const hadSave = safeGet(SAVE_KEY)
  const save = new SaveStore()
  if (!hadSave) save.update({ quality: suggestQuality() })
  const input = new Input(canvas)
  input.sensitivity = save.data.sensitivity
  const audio = new Audio()
  audio.setVolumes(save.data.musicVolume, save.data.sfxVolume, save.data.muted)
  const renderer = new Renderer(canvas, save.data.quality)
  const showAccount = (session: ManusSession): void => {
    if (session.status === 'authenticated') ui.setAccount('authenticated', session.user.name)
    else if (session.status === 'offline') ui.setAccount('offline')
    else ui.setAccount('logged_out')
  }
  let game!: FpsGame
  let ui!: FpsUI
  let lastMatch: MatchMode = 'survival'
  let ffaLoading = false
  let ffaAttempt = 0
  let audioUnlocked = false
  let activeTrack: MusicMode | null = null

  const playTrack = (mode: MusicMode): void => {
    if (!audioUnlocked || activeTrack === mode) return
    activeTrack = mode
    audio.startMusic(mode)
  }
  const reconcileTrack = (): void => {
    if (!game || game.mode !== 'playing') return
    playTrack(game.hudState().boss ? 'boss' : 'combat')
  }
  const onGesture = (): void => {
    if (!audioUnlocked) {
      audioUnlocked = true
      audio.unlock()
    }
    if (game?.mode === 'title') playTrack('title')
  }
  window.addEventListener('pointerdown', onGesture, { capture: true, passive: true })
  window.addEventListener('keydown', onGesture, { capture: true })
  window.addEventListener('gamepadconnected', onGesture)

  const accountAction = async (): Promise<void> => {
    const session = ManusAuth.get_session()
    ui.setAccount('checking')
    try {
      if (session?.status === 'authenticated') showAccount(await ManusAuth.logout())
      else {
        await ManusAuth.login()
        showAccount(await ManusAuth.prepare())
      }
    } catch (error) {
      console.warn('Optional account service is unavailable:', error)
      ui.setAccount('error')
    }
  }

  ui = new FpsUI(root, {
    start: mode => { void beginMatch(mode) },
    retryAssets: () => { void retryInitialAssets() },
    resume: () => { game.resume(); input.lockPointer() },
    restart: () => { void beginMatch(lastMatch) },
    quit: () => { ffaLoading = false; ffaAttempt++; game.toTitle() },
    pause: () => game.pause(),
    augment: index => { void game.chooseAugment(index) },
    retryStage: () => game.retryStage(game.run.wave + 1),
    settings: values => applySettings(values.quality, values.sensitivity, values.musicVolume, values.sfxVolume, values.muted),
    account: () => { void accountAction() },
    touch: (action, down) => input.setTouchButton(action, down),
    uiSound: () => audio.play('ui'),
  })
  ui.setArtwork(GAME_ART_URLS.loading, GAME_ART_URLS.favicon)
  ui.setSettings({ quality: save.data.quality, sensitivity: save.data.sensitivity, musicVolume: save.data.musicVolume, sfxVolume: save.data.sfxVolume, muted: save.data.muted })
  const touch = new TouchControls(root, input, () => game?.mode === 'playing')
  void touch
  void ManusAuth.prepare().then(showAccount).catch(error => {
    console.warn('Optional account check failed:', error)
    ui.setAccount('offline')
  })
  window.addEventListener('manus-auth-change', event => showAccount(event.detail))

  const applySettings = (quality: Quality, sensitivity: number, musicVolume: number, sfxVolume: number, muted: boolean): void => {
    save.update({ quality, sensitivity, musicVolume, sfxVolume, muted })
    input.sensitivity = save.data.sensitivity
    renderer.applyQuality(save.data.quality)
    audio.setVolumes(save.data.musicVolume, save.data.sfxVolume, save.data.muted)
  }

  game = new FpsGame(renderer, input, {
    screen: (mode: GameMode) => {
      ui.show(mode)
      if (mode === 'playing') {
        audio.startWorld()
        audio.muteWorld(false)
        if (input.method === 'keyboard') input.lockPointer()
        reconcileTrack()
      } else if (mode === 'paused' || mode === 'ended' || mode === 'title') {
        audio.muteWorld(true)
        audio.stopMusic()
        activeTrack = null
        input.unlockPointer()
        if (mode === 'title' && audioUnlocked) playTrack('title')
      } else if (mode === 'intermission') {
        audio.muteWorld(true)
      }
    },
    hud: state => ui.update(state),
    banner: (title, detail = '') => ui.banner(title, detail),
    popup: (text, kind = 'kill') => ui.popup(text, kind),
    hurt: (direction, armorBreak) => ui.hurt(direction, armorBreak),
    augments: (wave, options) => ui.showAugments(wave, options),
    stage: (status, wave) => ui.setStageStatus(status, wave),
    ended: (won, stats) => {
      ffaLoading = false
      audio.muteWorld(true)
      audio.stopMusic()
      activeTrack = null
      ui.showEnd(won, stats)
      audio.play(won ? 'win' : 'lose')
    },
  })
  canvas.addEventListener('click', () => { if (game.mode === 'playing') input.lockPointer() })
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.mode === 'playing' && input.method === 'keyboard') game.pause()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'playing') game.pause()
  })
  window.addEventListener('fps:sound', event => {
    const cue = (event as CustomEvent<string>).detail
    audio.playCue(cue === 'landing' ? 'land' : cue)
  })

  const beginMatch = async (mode: MatchMode): Promise<void> => {
    if (game.mode !== 'title' && game.mode !== 'ended' && game.mode !== 'paused') return
    lastMatch = mode
    audio.unlock()
    if (mode === 'ffa' && game.mode === 'title') {
      ffaLoading = true
      const attempt = ++ffaAttempt
      ui.setModeStatus('loading')
      if (input.method === 'keyboard') input.lockPointer()
      try {
        await game.warmStage(3)
        if (!ffaLoading || attempt !== ffaAttempt) return
      } catch (error) {
        if (attempt !== ffaAttempt) return
        console.error('Unable to load the offline arena:', error)
        ffaLoading = false
        ui.setModeStatus('error')
        input.unlockPointer()
        return
      }
      ffaLoading = false
      ui.setModeStatus('idle')
    }
    ffaLoading = false
    game.start(mode)
    input.lockPointer()
  }

  const retryInitialAssets = async (): Promise<void> => {
    if (game.mode !== 'boot') return
    ui.clearBootError()
    ui.setBootProgress(0, 'RETRYING FIRST-WAVE ASSETS')
    try {
      await game.retryInitialAssets(progress => ui.setBootProgress(0.08 + progress * 0.88, 'LOADING FIRST WAVE'))
      ui.setBootProgress(1, 'TERMINAL ONLINE')
    } catch (error) {
      console.error('First-wave asset load failed:', error)
      ui.setBootError()
    }
  }

  const cancelFfaLoad = (): void => {
    if (!ffaLoading) return
    ffaLoading = false
    ffaAttempt++
    ui.setModeStatus('idle')
    input.unlockPointer()
  }

  let loop!: GameLoop
  loop = new GameLoop({
    beforeFrame: (dt: number) => {
      input.update(dt)
      if (input.consume('pause')) {
        if (ui.settingsOpen) ui.closeSettings()
        else if (game.mode === 'playing') game.pause()
        else if (game.mode === 'paused') { game.resume(); input.lockPointer() }
        else cancelFfaLoad()
      }
      if (input.consume('back')) {
        if (ui.settingsOpen) ui.closeSettings()
        else if (game.mode === 'paused') { game.resume(); input.lockPointer() }
        else if (game.mode === 'ended') game.toTitle()
        else cancelFfaLoad()
      }
      if (game.mode !== 'playing' && game.mode !== 'boot') {
        if (input.consume('menuNext')) ui.navigate(1)
        if (input.consume('menuPrev')) ui.navigate(-1)
        if (input.consume('confirm')) { ui.activateFocused(); input.consume('jump') }
      } else {
        input.consume('confirm')
        input.consume('menuNext')
        input.consume('menuPrev')
      }
      loop.paused = game.mode !== 'playing'
    },
    step: (dt: number) => { if (game.mode === 'playing') game.step(dt) },
    render: (alpha: number, seconds: number) => {
      game.render(alpha, seconds)
      ui.update(game.hudState())
      reconcileTrack()
      input.endFrame()
    },
  })
  if (import.meta.env.DEV) void registerGameTuning(tuning).catch(error => console.warn('Preview Tweak registration failed:', error))
  loop.start()
  ui.setBootProgress(0.08, 'LOADING FIRST-WAVE ASSETS')
  try {
    await game.loadInitialAssets(progress => ui.setBootProgress(0.08 + progress * 0.88, 'LOADING FIRST WAVE'))
    ui.setBootProgress(1, 'TERMINAL ONLINE')
  } catch (error) {
    console.error('First-wave asset load failed:', error)
    ui.setBootError()
  }
}

function showFatalError(error: unknown): void {
  console.error('Dock Zero failed to start:', error)
  const app = document.querySelector<HTMLElement>('#app')
  if (!app) return
  const message = document.createElement('div')
  message.className = 'fatal-error'
  message.textContent = 'DOCK ZERO / GRAPHICS INITIALIZATION FAILED — RELOAD TO RETRY'
  app.replaceChildren(message)
}

void boot().catch(showFatalError)
