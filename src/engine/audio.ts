export type MusicMode = 'title' | 'combat' | 'boss'
export type Sfx = 'pickup' | 'jump' | 'land' | 'hurt' | 'ui' | 'win' | 'lose' | 'dash' | 'rifle' | 'shotgun' | 'rocket' | 'grenade' | 'enemy' | 'bot' | 'armorBreak' | 'slide' | 'reload' | 'melee' | 'overdrive' | 'impact' | 'shell' | 'bossStomp' | 'explosion'

const MAX_VOICES = 64

/** Bounded Web Audio mixer with separate world and interface routes. */
export class Audio {
  readonly ctx: AudioContext
  private readonly master: GainNode
  private readonly compressor: DynamicsCompressorNode
  private readonly musicBase: GainNode
  private readonly sfxBase: GainNode
  private readonly uiBase: GainNode
  private readonly music: GainNode
  private readonly sfx: GainNode
  private readonly ui: GainNode
  private readonly noise: AudioBuffer
  private readonly voices = new Set<AudioScheduledSourceNode>()
  private readonly ambience: AudioScheduledSourceNode[] = []
  private musicTimer = 0
  private musicOn = false
  private musicMode: MusicMode = 'title'
  private musicBar = 0
  private worldMuted = true
  private muted = false
  private musicVolume = 0.7
  private sfxVolume = 0.8
  private ambienceStarted = false
  private buffers = new Map<string, AudioBuffer>()

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.72
    this.compressor = this.ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -12
    this.compressor.knee.value = 8
    this.compressor.ratio.value = 6
    this.compressor.attack.value = 0.003
    this.compressor.release.value = 0.18
    this.musicBase = this.ctx.createGain(); this.musicBase.gain.value = 3
    this.sfxBase = this.ctx.createGain(); this.sfxBase.gain.value = 2
    this.uiBase = this.ctx.createGain(); this.uiBase.gain.value = 2
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.ui = this.ctx.createGain()
    this.musicBase.connect(this.music).connect(this.master)
    this.sfxBase.connect(this.sfx).connect(this.master)
    this.uiBase.connect(this.ui).connect(this.master)
    this.master.connect(this.compressor).connect(this.ctx.destination)
    const noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate)
    const data = noise.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    this.noise = noise
    this.applyMix()
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.applyMix()).catch(() => undefined)
  }

  /** Volumes in 0..1. Base boosts are applied once before each route. */
  setVolumes(music: number, sfx: number, muted = false): void {
    this.musicVolume = clamp01(music)
    this.sfxVolume = clamp01(sfx)
    this.muted = muted
    this.applyMix()
  }

  startWorld(): void {
    this.unlock()
    this.worldMuted = false
    if (!this.ambienceStarted) this.startAmbience()
    this.applyMix()
  }

  muteWorld(muted: boolean): void {
    this.worldMuted = muted
    this.applyMix()
  }

  async load(url: string): Promise<AudioBuffer> {
    const cached = this.buffers.get(url)
    if (cached) return cached
    const data = await (await fetch(url)).arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    this.buffers.set(url, buffer)
    if (this.buffers.size > 12) this.buffers.delete(this.buffers.keys().next().value as string)
    return buffer
  }

  playBuffer(buffer: AudioBuffer, bus: 'music' | 'sfx' = 'sfx', loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = loop
    if (this.voices.size >= MAX_VOICES) return src
    src.connect(bus === 'music' ? this.musicBase : this.sfxBase)
    this.track(src)
    src.start()
    return src
  }

  /** The starter's small cue API remains available to the rest of the game shell. */
  play(name: Sfx): void {
    if (name === 'ui' || name === 'win' || name === 'lose') {
      this.playUi(name)
      return
    }
    this.playCue(name)
  }

  /** Generated, layered combat/ambience sounds go through the world bus and stop on pause. */
  playCue(name: string): void {
    if (this.ctx.state !== 'running' || this.worldMuted || this.muted) return
    switch (name) {
      case 'rifle': this.noiseShot(this.sfxBase, 1850, 0.045, 0.14); this.tone(this.sfxBase, 132, 46, 0.09, 'triangle', 0.09); break
      case 'shotgun': this.noiseShot(this.sfxBase, 980, 0.085, 0.2); this.tone(this.sfxBase, 108, 38, 0.13, 'sine', 0.14); break
      case 'rocket': this.noiseShot(this.sfxBase, 440, 0.18, 0.2); this.tone(this.sfxBase, 82, 34, 0.2, 'sine', 0.12); break
      case 'grenade':
      case 'explosion': this.noiseShot(this.sfxBase, 350, 0.3, 0.24); this.tone(this.sfxBase, 74, 26, 0.36, 'sine', 0.18); break
      case 'enemyFire':
      case 'enemy': this.noiseShot(this.sfxBase, 1040, 0.05, 0.1); this.tone(this.sfxBase, 190, 74, 0.11, 'square', 0.035); break
      case 'botFire':
      case 'bot': this.noiseShot(this.sfxBase, 1350, 0.05, 0.1); this.tone(this.sfxBase, 260, 88, 0.1, 'square', 0.035); break
      case 'armorBreak': this.noiseShot(this.sfxBase, 700, 0.18, 0.14); this.tone(this.sfxBase, 286, 76, 0.22, 'triangle', 0.13); break
      case 'hurt': this.tone(this.sfxBase, 180, 75, 0.18, 'sawtooth', 0.1); break
      case 'pickup': this.tone(this.sfxBase, 850, 1320, 0.105, 'triangle', 0.09); this.tone(this.sfxBase, 1280, 1650, 0.1, 'sine', 0.07, 0.055); break
      case 'slide': this.noiseShot(this.sfxBase, 530, 0.16, 0.06); break
      case 'reload': this.tone(this.sfxBase, 860, 520, 0.04, 'square', 0.04); this.tone(this.sfxBase, 610, 900, 0.045, 'triangle', 0.03, 0.08); break
      case 'melee': this.noiseShot(this.sfxBase, 470, 0.09, 0.07); this.tone(this.sfxBase, 116, 50, 0.1, 'triangle', 0.065); break
      case 'jump': this.tone(this.sfxBase, 265, 505, 0.1, 'triangle', 0.05); break
      case 'land': this.tone(this.sfxBase, 112, 52, 0.08, 'sine', 0.085); break
      case 'dash': this.tone(this.sfxBase, 500, 180, 0.15, 'sawtooth', 0.07); break
      case 'overdrive': this.tone(this.sfxBase, 178, 960, 0.42, 'sawtooth', 0.105); this.tone(this.sfxBase, 420, 720, 0.3, 'sine', 0.07, 0.08); break
      case 'impact': this.noiseShot(this.sfxBase, 1100, 0.045, 0.07); break
      case 'shell': this.tone(this.sfxBase, 1430, 780, 0.05, 'triangle', 0.03); break
      case 'bossStomp': this.tone(this.sfxBase, 86, 29, 0.3, 'sine', 0.15); this.noiseShot(this.sfxBase, 510, 0.14, 0.1); break
    }
  }

  /** Independent title, battle, and boss music; pause/game-over silences the bus immediately. */
  startMusic(mode: MusicMode = 'title'): void {
    if (this.musicOn && this.musicMode === mode) return
    window.clearTimeout(this.musicTimer)
    this.musicMode = mode
    this.musicOn = true
    this.musicBar = 0
    this.applyMix()
    this.scheduleMusic()
  }

  stopMusic(): void {
    this.musicOn = false
    window.clearTimeout(this.musicTimer)
    this.musicTimer = 0
    const t = this.ctx.currentTime
    this.music.gain.cancelScheduledValues(t)
    this.music.gain.setTargetAtTime(0, t, 0.006)
  }

  dispose(): void {
    this.stopMusic()
    for (const source of this.voices) { try { source.stop() } catch {} ; source.disconnect() }
    this.voices.clear(); this.ambience.length = 0
    void this.ctx.close().catch(() => undefined)
  }

  private applyMix(): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(this.muted || !this.musicOn ? 0 : this.musicVolume * 0.55, t, 0.025)
    this.sfx.gain.setTargetAtTime(this.muted || this.worldMuted ? 0 : this.sfxVolume * 0.8, t, 0.018)
    this.ui.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume * 0.8, t, 0.025)
  }

  private startAmbience(): void {
    this.ambienceStarted = true
    const rain = this.ctx.createBufferSource(); rain.buffer = this.noise; rain.loop = true
    const rainFilter = this.ctx.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 1180
    const rainGain = this.ctx.createGain(); rainGain.gain.value = 0.025
    rain.connect(rainFilter).connect(rainGain).connect(this.sfxBase); this.track(rain); rain.start(); this.ambience.push(rain)
    const harbor = this.ctx.createOscillator(); harbor.type = 'sine'; harbor.frequency.value = 43
    const harborFilter = this.ctx.createBiquadFilter(); harborFilter.type = 'lowpass'; harborFilter.frequency.value = 92
    const harborGain = this.ctx.createGain(); harborGain.gain.value = 0.018
    harbor.connect(harborFilter).connect(harborGain).connect(this.sfxBase); this.track(harbor); harbor.start(); this.ambience.push(harbor)
  }

  private scheduleMusic(): void {
    if (!this.musicOn) return
    const mode = this.musicMode
    const title = mode === 'title', boss = mode === 'boss'
    const roots = title ? [146.83, 130.81, 110, 123.47] : boss ? [110, 116.54, 98, 103.83] : [130.81, 146.83, 164.81, 123.47]
    const root = roots[Math.floor(this.musicBar / (title ? 2 : 1)) % roots.length]
    const duration = title ? 2.15 : boss ? 0.56 : 0.72
    const t = this.ctx.currentTime + 0.035
    for (const [i, ratio] of [1, boss ? 1.189 : 1.2, 1.498].entries()) {
      const f = root * ratio
      this.tone(this.musicBase, f, f * 0.997, title ? 1.75 : duration, i === 0 ? 'triangle' : 'sine', title ? 0.012 : 0.009, i * 0.018)
    }
    if (!title) {
      const bass = boss ? 48 : 55
      this.tone(this.musicBase, bass, bass * 0.72, boss ? 0.25 : 0.18, 'sine', boss ? 0.055 : 0.04, 0.01)
      if (this.musicBar % 2 === 0) this.noiseShot(this.musicBase, boss ? 175 : 235, 0.055, boss ? 0.035 : 0.02, t + 0.03)
      if (boss && this.musicBar % 4 === 2) this.tone(this.musicBase, 293.66, 73.42, 0.42, 'sawtooth', 0.018, 0.08)
    } else if (this.musicBar % 2 === 0) this.tone(this.musicBase, root * 2, root * 2.015, 1.1, 'sine', 0.006, 0.08)
    this.musicBar++
    this.musicTimer = window.setTimeout(() => this.scheduleMusic(), title ? 1720 : boss ? 420 : 590)
  }

  private playUi(name: 'ui' | 'win' | 'lose'): void {
    const afterUnlock = () => {
      if (name === 'ui') this.tone(this.uiBase, 680, 710, 0.055, 'triangle', 0.095)
      else (name === 'win' ? [523, 659, 784, 988] : [392, 330, 262]).forEach((f, i) => this.tone(this.uiBase, f, f * (name === 'win' ? 1.005 : 0.98), 0.3, 'triangle', 0.13, i * 0.11))
    }
    if (this.ctx.state === 'running') afterUnlock()
    else if (this.ctx.state === 'suspended') void this.ctx.resume().then(afterUnlock).catch(() => undefined)
  }

  private tone(bus: GainNode, frequency: number, end: number, duration: number, type: OscillatorType, volume: number, offset = 0): void {
    if (this.voices.size >= MAX_VOICES) return
    const t = this.ctx.currentTime + offset
    const oscillator = this.ctx.createOscillator(), envelope = this.ctx.createGain()
    oscillator.type = type; oscillator.frequency.setValueAtTime(Math.max(20, frequency), t)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration)
    envelope.gain.setValueAtTime(0.0001, t); envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + Math.min(0.012, duration * 0.25))
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    oscillator.connect(envelope).connect(bus); this.track(oscillator); oscillator.start(t); oscillator.stop(t + duration + 0.025)
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect() }
  }

  private noiseShot(bus: GainNode, cutoff: number, duration: number, volume: number, when = this.ctx.currentTime + 0.005): void {
    if (this.voices.size >= MAX_VOICES) return
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), envelope = this.ctx.createGain()
    source.buffer = this.noise; filter.type = 'lowpass'; filter.frequency.setValueAtTime(cutoff, when); filter.frequency.exponentialRampToValueAtTime(Math.max(70, cutoff * 0.42), when + duration)
    envelope.gain.setValueAtTime(Math.max(0.0001, volume), when); envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration)
    source.connect(filter).connect(envelope).connect(bus); this.track(source); source.start(when); source.stop(when + duration + 0.01)
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect() }
  }

  private track(source: AudioScheduledSourceNode): void {
    this.voices.add(source)
    source.addEventListener('ended', () => this.voices.delete(source), { once: true })
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
