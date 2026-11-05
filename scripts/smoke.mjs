// End-to-end smoke test for the built Dock Zero FPS. Managed Storage assets are intercepted
// with the exact hash-locked local inputs so a local Vite preview needs no user account/network.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })
const manifest = JSON.parse(readFileSync('assets.lock.json', 'utf8'))
const sourceByStoragePath = new Map(Object.entries(manifest.assets).map(([source, item]) => [item.path, join(process.cwd(), source)]))
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out after 120 seconds'), 120_000)

function cleanup() { clearTimeout(guard); try { server.kill('SIGTERM') } catch {} }
async function fail(message) {
  console.error(`smoke: FAIL — ${message}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}
async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Vite preview server did not start')
}
function collectErrors(page, errors) {
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', error => errors.push(String(error)))
  page.on('response', response => {
    if (response.status() < 400) return
    const pathname = new URL(response.url()).pathname
    // Account checks are optional; missing local API is the documented offline state.
    if (!pathname.startsWith('/api/')) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })
}
async function openGame(context, errors, file) {
  await context.route('**/manus-storage/game/sha256/**', route => {
    const pathname = new URL(route.request().url()).pathname
    const source = sourceByStoragePath.get(pathname)
    if (!source) return route.fulfill({ status: 404, body: 'Unknown locked game asset' })
    return route.fulfill({ path: source })
  })
  const page = await context.newPage()
  collectErrors(page, errors)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 50_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.documentElement.lang !== 'en') throw new Error(`expected English UI; got ${document.documentElement.lang}`)
    if (![...document.fonts].some(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'ManusCC0' && face.status === 'loaded')) throw new Error('Bundled English font did not load')
    const icon = document.querySelector('.boot-icon')
    if (!icon?.src.includes('/manus-storage/game/sha256/')) throw new Error('Custom Dock Zero icon URL was not installed')
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/${file}` })
  return page
}
const text = (page, selector) => page.locator(selector).innerText()

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US' })
  const page = await openGame(desktop, errors, '01-title.png')
  console.log('smoke: title ready')
  if (!(await text(page, '.title-logo')).includes('DOCK ZERO')) throw new Error('Dock Zero title is missing')
  if ((await page.locator('[data-mode="survival"]').count()) !== 1 || (await page.locator('[data-mode="ffa"]').count()) !== 1) throw new Error('Both offline modes must be selectable')

  await page.click('[data-action="start"][data-mode="survival"]')
  await page.waitForSelector('[data-screen="hud"].is-active', { timeout: 12_000 })
  await page.waitForTimeout(650)
  if ((await text(page, '[data-hud="armor"]')).trim() !== '150') throw new Error('Survival did not start at 150 armor')
  if ((await text(page, '[data-hud="ammo"]')).trim() !== '30') throw new Error('Rifle magazine is not ready at match start')
  const clockBefore = (await text(page, '[data-hud="time"]')).trim()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(700)
  await page.keyboard.up('KeyW')
  await page.mouse.move(640, 360)
  await page.mouse.down()
  await page.waitForTimeout(170)
  await page.mouse.up()
  await page.waitForTimeout(400)
  if ((await text(page, '[data-hud="time"]')).trim() === clockBefore) throw new Error('Survival simulation clock did not run')
  const ammoAfterShot = Number((await text(page, '[data-hud="ammo"]')).trim())
  if (!(ammoAfterShot < 30)) throw new Error('Mouse fire did not consume a rifle round')
  await page.screenshot({ path: `${out}/02-survival.png` })
  console.log('smoke: survival/fire passed')

  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.screenshot({ path: `${out}/03-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings-open"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.locator('[data-setting="quality"]').evaluate(el => { el.value = 'medium' })
  await page.locator('[data-setting="sensitivity"]').evaluate(el => { el.value = '1.2' })
  await page.screenshot({ path: `${out}/04-settings.png` })
  console.log('smoke: pause/settings opened')
  const applyHit = await page.locator('[data-action="settings-apply"]').evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { button: el.outerHTML, hit: hit?.outerHTML.slice(0, 100), pointer: getComputedStyle(hit ?? el).pointerEvents } })
  console.log('smoke: settings apply hit test', JSON.stringify(applyHit))
  await page.click('[data-action="settings-apply"]')
  await page.waitForTimeout(100)
  const screenStates = await page.locator('[data-screen]').evaluateAll(nodes => nodes.map(node => ({ name: node.getAttribute('data-screen'), active: node.classList.contains('is-active'), display: getComputedStyle(node).display })))
  console.log('smoke: post-settings screens', JSON.stringify(screenStates))
  if (screenStates.some(screen => screen.name === 'settings' && screen.active)) throw new Error(`Settings Apply did not close the screen${errors.length ? `; browser errors: ${errors.join(' | ')}` : ''}`)
  const resumeHit = await page.locator('[data-screen="pause"] [data-action="resume"]').evaluate(el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { button: el.outerHTML, hit: hit?.outerHTML.slice(0, 100), pointer: getComputedStyle(hit ?? el).pointerEvents } })
  if (!resumeHit.hit?.includes('data-action="resume"') || resumeHit.pointer !== 'auto') throw new Error(`Resume button center is not interactive: ${JSON.stringify(resumeHit)}`)
  await page.click('[data-screen="pause"] [data-action="resume"]', { timeout: 5000 })
  await page.waitForSelector('[data-screen="hud"].is-active')
  console.log('smoke: resumed from settings')
  // The HUD button swaps out its own screen synchronously; DOM activation avoids a false Playwright wait on that detach.
  await page.locator('[data-action="pause"]').evaluate(el => el.click())
  await page.click('[data-screen="pause"] [data-action="quit"]')
  await page.waitForSelector('[data-screen="title"].is-active')

  await page.click('[data-action="start"][data-mode="ffa"]')
  await page.waitForFunction(() => !document.querySelector('[data-mode="ffa"]')?.disabled, { timeout: 30_000 })
  const ffaStatus = (await text(page, '.mode-status')).trim()
  if (ffaStatus.includes('UNAVAILABLE')) throw new Error(`FFA arena preload failed: ${ffaStatus}`)
  await page.waitForSelector('[data-screen="hud"].is-active', { timeout: 30_000 })
  console.log('smoke: FFA HUD ready')
  await page.waitForTimeout(700)
  if ((await text(page, '[data-hud="alive"]')).trim() !== '7') throw new Error('FFA must start with six bots plus the operator')
  if ((await text(page, '[data-hud="wave"]')).trim() !== '01') throw new Error('FFA HUD was not initialized')
  await page.screenshot({ path: `${out}/05-ffa.png` })
  await page.locator('[data-action="pause"]').evaluate(el => el.click())
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.click('[data-screen="pause"] [data-action="quit"]')
  await page.waitForSelector('[data-screen="title"].is-active')
  await desktop.close()

  const mobile = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'en-US' })
  await mobile.addInitScript(() => localStorage.setItem('game3d.save', JSON.stringify({ version: 1, quality: 'low' })))
  const phone = await openGame(mobile, errors, '06-landscape-title.png')
  console.log('smoke: landscape title ready')
  await phone.tap('[data-action="start"][data-mode="survival"]')
  await phone.waitForSelector('[data-screen="hud"].is-active', { timeout: 12_000 })
  await phone.waitForTimeout(450)
  if (!(await phone.locator('.touch-stick').isVisible())) throw new Error('Landscape touch movement stick is not visible')
  if (!(await phone.locator('[data-touch="fire"]').isVisible())) throw new Error('Landscape touch fire control is not visible')
  await mobile.close()

  if (errors.length) throw new Error(`browser errors:\n  ${errors.join('\n  ')}`)
  await browser.close(); cleanup()
  console.log(`smoke: OK — survival, mouse fire, pause/settings, offline six-bot FFA and landscape HUD; screenshots in ${out}/`)
} catch (error) { await fail(error?.message ?? String(error)) }
