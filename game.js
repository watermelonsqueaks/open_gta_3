const BUILD_VERSION = 159;
const DEFAULTS_RESET_VERSION = 140;
const ASSET_CACHE_NAME = 'gta3-assets-v2';
const PRELOAD_CONCURRENCY = 32;
const ASSET_PREFIX = 'gta3-assets/local';
const DEPLOYMENT_PREFIX = "";
/* Asset base resolves relative to current page for 100% GitHub Pages / sub-path compatibility */
const ASSET_BASE = DEPLOYMENT_PREFIX.length > 0 ? DEPLOYMENT_PREFIX + ASSET_PREFIX + "/" : new URL(`${ASSET_PREFIX}/`, window.location.href).href;
const ASSET_BASES_WORKING = [ASSET_BASE];
const PRELOAD_URL = new URL('preload_files.list?v=' + Date.now(), window.location.href).href;
const STREAM_URL = new URL('stream_files.list?v=' + Date.now(), window.location.href).href;

/* Every audio stem on disk is exclusively .mp3 OR .wav (never both).
 * Requesting the wrong extension floods the console with 404s. */
const AUDIO_MP3_STEMS = new Set((
  'bet c1_tex d1_stog d2_kk d3_ado d4_gta d4_gta2 d5_es d6_sts d7_mld ' +
  'el_ph1 el_ph2 el_ph3 el_ph4 end hd_ph1 hd_ph2 hd_ph3 hd_ph4 hd_ph5 ' +
  'j0_dm2 j1_lfl j2_kcl j3_vh j4_eth j5_dst j6_tbj jb k1_kbo k2_gis k3_ds ' +
  'k4_shi k4_shi2 k5_sd l1_lg l2_dsb l3_dm l4_pap l5_tfb mt_ph1 mt_ph2 ' +
  'mt_ph3 mt_ph4 r0_pdr2 r1_sw r2_ap r3_ed r4_gf r5_pb r6_mm s0_mas s1_pf ' +
  's2_ctg s2_ctg2 s3_rtc s4_bdba s4_bdbb s4_bdbd s5_lrq s5_lrqb s5_lrqc ' +
  't1_tol t2_tpu t3_mas t4_tat t5_bf yd_ph1 yd_ph2 yd_ph3 yd_ph4'
).split(/\s+/));

function resolveAudioRel(rel) {
  const r = normalizeAssetRel(rel);
  /* Per-sample SFX stay as requested (.mp3 under sfx.raw/). */
  if (r.includes('/sfx') || r.startsWith('sfx')) return r;
  const m = r.match(/^audio\/([^/]+)\.(wav|mp3)$/i);
  if (!m) return r;
  const stem = m[1].toLowerCase();
  const want = AUDIO_MP3_STEMS.has(stem) ? 'mp3' : 'wav';
  return `audio/${stem}.${want}`;
}

function isWrongAudioFormat(rel) {
  const r = normalizeAssetRel(rel);
  if (r.includes('/sfx') || r.startsWith('sfx')) return false;
  const m = r.match(/^audio\/([^/]+)\.(wav|mp3)$/i);
  if (!m) return false;
  return resolveAudioRel(r) !== r;
}

const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const tapHintEl = document.getElementById('tap-hint');
const canvas = document.getElementById('canvas');

function wantsTouchControls() {
  const params = new URLSearchParams(location.search);
  if (params.get('touch') === '0') return false;
  if (params.get('touch') === '1' || window.__wantsTouch === true) return true;

  const ua = (navigator.userAgent || '').toLowerCase();
  const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(ua);
  const isIpadOS = (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isCoarseOnly = window.matchMedia &&
    window.matchMedia('(pointer: coarse) and (hover: none)').matches;

  return isMobile || isIpadOS || isCoarseOnly;
}

const isTouchDevice = wantsTouchControls();

/* Emulated Pointer Lock for Touch Devices
 * Mobile browsers do not support desktop document.requestPointerLock().
 * Emscripten's GLFW calculateMouseEvent handler checks Browser.pointerLock to accumulate
 * continuous movement deltas (movementX/movementY). When Browser.pointerLock is false,
 * it resets mouseX/mouseY to client coordinates, which breaks 360-degree camera swiping.
 */
let isVirtualPointerLocked = false;
const origPointerLockElement = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement') ||
  Object.getOwnPropertyDescriptor(document, 'pointerLockElement');

try {
  Object.defineProperty(document, 'pointerLockElement', {
    get() {
      if (isTouchDevice && isVirtualPointerLocked) {
        return canvas || document.getElementById('canvas') || document.body;
      }
      if (origPointerLockElement && origPointerLockElement.get) {
        return origPointerLockElement.get.call(document);
      }
      return null;
    },
    configurable: true
  });
} catch (err) {
  console.warn('[regta3] Failed to define pointerLockElement getter:', err);
}

function enableVirtualPointerLock() {
  if (!isTouchDevice) return;
  if (!isVirtualPointerLocked) {
    isVirtualPointerLocked = true;
    try {
      document.dispatchEvent(new Event('pointerlockchange'));
    } catch (_) {}
  }
}

function disableVirtualPointerLock() {
  if (!isTouchDevice) return;
  if (isVirtualPointerLocked) {
    isVirtualPointerLocked = false;
    try {
      document.dispatchEvent(new Event('pointerlockchange'));
    } catch (_) {}
  }
}

if (canvas) {
  const origRequestPointerLock = canvas.requestPointerLock ? canvas.requestPointerLock.bind(canvas) : null;
  canvas.requestPointerLock = function() {
    if (isTouchDevice) {
      enableVirtualPointerLock();
      return Promise.resolve();
    }
    if (origRequestPointerLock) {
      try {
        return origRequestPointerLock.call(this);
      } catch (_) {}
    }
  };
}

/* [Controller] Method: 0 = CONTROL_STANDARD (mouse look camera),
 * 1 = CONTROL_CLASSIC (console scheme, target lock).
 * On mobile touch controls we enforce Method=0 so touch dragging/swiping
 * freely rotates the camera around Claude / car just like in modern mobile 3D games. */
function applyTouchControlMethod(ini) {
  let res = ini || defaultRe3Ini;
  if (/Method=\d+/i.test(res)) {
    res = res.replace(/Method=\d+/i, 'Method=0');
  } else {
    res += '\n[Controller]\nMethod=0\n';
  }
  if (/DisableMouseSteering=\d+/i.test(res)) {
    res = res.replace(/DisableMouseSteering=\d+/i, 'DisableMouseSteering=1');
  } else {
    res += 'DisableMouseSteering=1\n';
  }
  return res;
}

const defaultRe3Ini = `[VideoMode]
Width=1280
Height=720
Depth=32
Subsystem=0
Windowed=1

[Controller]
HeadBob1stPerson=0
HorizantalMouseSens=0.002500
InvertMouseVertically=1
DisableMouseSteering=1
Vibration=0
Method=0
InvertPad=0

[Audio]
SfxVolume=64
MusicVolume=64
MP3BoostVolume=0
Radio=0
SpeakerType=0
Provider=0
DynamicAcoustics=0

[Display]
Brightness=256
DrawDistance=1.200000
Subtitles=1
ShowHud=1
RadarMode=0
ShowLegends=0
PedDensity=1.000000
CarDensity=1.000000
CutsceneBorders=1

[Graphics]
AspectRatio=0
VSync=1
Trails=1
FrameLimiter=0
MultiSampling=0

[General]
SkinFile=$$""
Language=0
DrawVersionText=0
NoMovies=1
`;

function sanitizeRe3Ini(ini) {
  // Guard against a saved mute from earlier broken sessions.
  let out = ini || defaultRe3Ini;
  out = out.replace(/SfxVolume=\d+/i, 'SfxVolume=64');
  out = out.replace(/MusicVolume=\d+/i, 'MusicVolume=64');
  if (!/SfxVolume=/i.test(out)) out += '\nSfxVolume=64\n';
  if (!/MusicVolume=/i.test(out)) out += '\nMusicVolume=64\n';
  out = applyTouchControlMethod(out);
  return out;
}
let re3Ini = sanitizeRe3Ini(localStorage.getItem('regta3dos.re3.ini') || defaultRe3Ini);

/* Язык из query-параметра (?lang=ru | en | fr | de | it | es | pl | ja,
 * либо число 0..7 — enum CMenuManager::LANGUAGE). Пока параметр присутствует
 * в URL, он сильнее сохранённых настроек: применяется поверх
 * userfiles/re3.ini на каждом буте (re3.ini переопределяет gta3.set,
 * см. LoadINISettings в src/core/Frontend.cpp). */
const LANGUAGE_CODES = {
  en: 0, american: 0, english: 0,
  fr: 1, french: 1,
  de: 2, german: 2,
  it: 3, italian: 3,
  es: 4, spanish: 4,
  pl: 5, polish: 5,
  ru: 6, russian: 6,
  ja: 7, japanese: 7,
};
const languageOverride = (() => {
  try {
    const raw = (new URLSearchParams(location.search).get('lang') || '').trim().toLowerCase();
    if (!raw) return 0; // Default to English (0)
    if (raw in LANGUAGE_CODES) return LANGUAGE_CODES[raw];
    const num = parseInt(raw, 10);
    if (Number.isInteger(num) && num >= 0 && num <= 7) return num;
    console.warn('[regta3] unknown lang query param:', raw);
    return 0;
  } catch (_) {
    return 0;
  }
})();

function applyLanguageOverride(ini) {
  const lang = (languageOverride === null) ? 0 : languageOverride;
  const line = 'Language=' + lang;
  if (/Language=\d+/i.test(ini)) return ini.replace(/Language=\d+/i, line);
  return ini + '\n[General]\n' + line + '\n';
}

/* Controller Method management is declared at the top of game.js */
let bootStarted = false;
let audioUnlocked = false;
let worldLoadComplete = false;
let autoEnterDone = false;
let worldStreamStarted = false;
const trackedAudioContexts = new Set();
const asyncUrlCache = new Map();
const assetDataCache = new Map();
const assetNotFound = new Set();
const streamedPreloadLog = new Set();

function toPreloadListPath(path) {
  const normalized = normalizeAssetRel(path);
  const rel = normalized.replace(/^gta3-assets\/local\//i, '');
  return `${ASSET_PREFIX}/${rel}`;
}

function parsePreloadList(text) {
  const paths = [];
  const seen = new Set();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const path = toPreloadListPath(line);
    const key = normalizeAssetRel(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

function recordStreamedPreload(rel) {
  streamedPreloadLog.add(toPreloadListPath(rel));
}

function printStreamedPreloadLog() {
  const lines = ['# regta3dos streamed preload list', ...streamedPreloadLog];
  const text = lines.join('\n');
  console.log(text);
  streamedPreloadLog.clear();
  return text;
}

window.regta3PrintStreamedPreload = printStreamedPreloadLog;
window.regta3DumpStreamedPreload = printStreamedPreloadLog;

/** Track every AudioContext OpenAL creates (must run before createRe3Module). */
(function patchAudioContextTracking() {
  const Orig = window.AudioContext || window.webkitAudioContext;
  if (!Orig || Orig.__regta3Patched) return;
  class PatchedAudioContext extends Orig {
    constructor(...args) {
      super(...args);
      trackedAudioContexts.add(this);
      // Browsers often start suspended; resume as soon as a gesture arrives.
      const kick = () => {
        if (this.state === 'suspended') {
          this.resume().catch(() => {});
        }
      };
      for (const ev of ['keydown', 'mousedown', 'pointerdown', 'touchstart']) {
        document.addEventListener(ev, kick, true);
      }
    }
  }
  PatchedAudioContext.__regta3Patched = true;
  window.AudioContext = PatchedAudioContext;
  if ('webkitAudioContext' in window) window.webkitAudioContext = PatchedAudioContext;
})();

// Frame-level watchdog: detect hang inside CGame::Process on Frame 1
let frameEnterTime = 0;
let frameIndex = -1;
let frameFinished = true;
let syncCallCount = 0;
let syncCallLog = [];
let lastSlowEnsure = '';
let ensureBudgetUsedMs = 0;
let ensureBudgetWindowStart = 0;
const ENSURE_BUDGET_PER_FRAME_MS = 12;
/* Absolute ceiling even for "critical" paths — unlimited sync XHR hard-froze
 * free roam after ~30s when ped/SFX storms ignored the soft budget. */
const ENSURE_HARD_CAP_PER_FRAME_MS = 28;

let engineSpinnerActive = false;
let mainMenuLoaded = false;

function showEngineStartingSpinner() {
  if (mainMenuLoaded) return;
  const el = document.getElementById('engine-spinner');
  if (el) {
    el.hidden = false;
    el.classList.remove('hidden');
    engineSpinnerActive = true;
    if (typeof window.remoteLog === 'function') {
      window.remoteLog('INFO', 'SPINNER', 'Engine starting spinner shown (bottom-right)');
    }
  }
}

function hideEngineStartingSpinner() {
  const el = document.getElementById('engine-spinner');
  if (el && engineSpinnerActive) {
    el.classList.add('hidden');
    setTimeout(() => {
      el.hidden = true;
    }, 400);
    engineSpinnerActive = false;
    if (typeof window.remoteLog === 'function') {
      window.remoteLog('INFO', 'SPINNER', 'Engine starting spinner hidden');
    }
  }
}

window.showEngineStartingSpinner = showEngineStartingSpinner;
window.hideEngineStartingSpinner = hideEngineStartingSpinner;

function showDiagError(msg) {
  console.warn('[regta3] DIAGNOSTIC:', msg);
  setStatus('ERROR: ' + msg);
  if (typeof window.showSystemError === 'function') {
    window.showSystemError(msg);
  }
  hideEngineStartingSpinner();
}

// Catch WASM traps / JS errors from the rAF callback
window.addEventListener('error', (ev) => {
  const err = ev.error || ev;
  let msg = (err && err.message) ? err.message : String(err || ev.message || 'Unknown error');
  if (msg.includes('ResizeObserver loop completed') || msg.includes('ResizeObserver loop limit')) return;
  if (msg.includes('RuntimeError') || msg.includes('unreachable') || msg.includes('memory access') ||
      msg.includes('abort') || msg.includes('Aborted') || msg.includes('wasm')) {
    msg = 'WASM crash: ' + msg + '\n[sync calls in last frame: ' + syncCallCount + ']\n' + syncCallLog.slice(-10).join('\n');
  }
  showDiagError(msg);
});

window.addEventListener('unhandledrejection', (ev) => {
  const msg = ev.reason ? String(ev.reason.message || ev.reason) : 'unknown';
  console.error('[regta3] Unhandled rejection:', msg);
  showDiagError('Unhandled rejection: ' + msg);
});

function updateLoaderUI(done, total, statusText, fileDetail) {
  const loaderPercent = document.getElementById('loader-percent');
  const loaderProgressBar = document.getElementById('loader-progress-bar');
  const loaderStatusText = document.getElementById('loader-status-text');
  const loaderFileDetail = document.getElementById('loader-file-detail');

  if (loaderPercent && total > 0) {
    const pct = Math.min(100, Math.round((done / total) * 100));
    loaderPercent.textContent = pct + '%';
    if (loaderProgressBar) {
      loaderProgressBar.style.width = pct + '%';
    }
  }
  if (statusText && loaderStatusText) {
    loaderStatusText.textContent = statusText;
  }
  if (fileDetail && loaderFileDetail) {
    loaderFileDetail.textContent = fileDetail;
  }
}

function hideLoaderUI() {
  const loaderOverlay = document.getElementById('loader-overlay');
  if (loaderOverlay) {
    loaderOverlay.classList.add('hidden');
    setTimeout(() => {
      loaderOverlay.style.display = 'none';
    }, 600);
  }
  // File downloading finished; show bottom-right loading circle until main menu is ready
  showEngineStartingSpinner();
}

function setStatus(text) {
  if (text) {
    console.log('[regta3] status:', text);
    const cleanText = text.replace(/^\[regta3\]\s*/i, '');
    updateLoaderUI(0, 0, cleanText, null);
  }
}

function setProgress(done, total) {
  if (!total) return;
  updateLoaderUI(done, total, null, null);
}

function hideTapHint() {
  if (tapHintEl) tapHintEl.hidden = true;
}

function markGameStarted() {
  mainMenuLoaded = true;
  hideEngineStartingSpinner();
  worldLoadComplete = true;
  setProgress(0, 0);
  hideTapHint();
  hideLoaderUI();
  document.body.classList.add('game-started');
  document.body.dataset.stateMenu = '0';
  document.body.dataset.stateCutscene = '0';
  if (!document.body.dataset.stateCar) {
    document.body.dataset.stateCar = '0';
  }
}

function simulateEnter(target) {
  const el = target || canvas || window;
  const opts = {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup', opts));
}

function maybeAutoEnter(line) {
  if (autoEnterDone) return;
  // Only auto-enter if explicitly requested via ?autostart=1 (for automated tests)
  const isAutoStart = (new URLSearchParams(location.search).get('autostart') === '1');
  if (!isAutoStart) return;
  if (!line.includes('[regta3] gGameState = GS_FRONTEND')) return;
  autoEnterDone = true;
  if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'AUTOSTART', 'Auto-starting new game via ?autostart=1');
  const target = canvas || window;
  let n = 0;
  const kick = () => {
    simulateEnter(target);
    n += 1;
    if (n < 3) setTimeout(kick, 700);
  };
  setTimeout(kick, 400);
}

/* Background prefetch of ALL remaining world DFF models from stream_files.list.
 * Called once when GS_FRONTEND is detected. Runs in background with low concurrency
 * so it doesn't starve the main game loop. Uses the same prefetchAssetAsync mechanism
 * which writes files to VFS and OPFS cache. */
let worldStreamDone = 0;
let worldStreamTotal = 0;
async function prefetchWorldModels() {
  if (worldStreamStarted) return;
  worldStreamStarted = true;
  let lines = [];
  try {
    const res = await fetch(STREAM_URL);
    if (res.ok) {
      const text = await res.text();
      lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    }
  } catch (err) {
    if (typeof window.remoteLog === 'function') window.remoteLog('WARN', 'STREAM', 'stream_files.list fetch failed: ' + (err && err.message ? err.message : err));
    return;
  }
  if (!lines.length) return;
  worldStreamTotal = lines.length;
  if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STREAM', 'Queuing ' + worldStreamTotal + ' world DFF models for background prefetch');
  /* Pump in small batches so the page stays responsive */
  let i = 0;
  const BATCH = 8;
  const pump = () => {
    for (let n = 0; n < BATCH && i < lines.length; n++, i++) {
      const rel = lines[i].replace(/^gta3-assets\/local\//i, '');
      prefetchAssetAsync(rel);
    }
    worldStreamDone = i;
    if (i < lines.length) {
      setTimeout(pump, 20);
    } else {
      if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STREAM', 'All ' + worldStreamTotal + ' world DFF models queued');
    }
  };
  setTimeout(pump, 500);
}

function updateStatusFromRegta3(line) {
  maybeAutoEnter(line);
  // Start world model background stream when menu is ready
  if (line.includes('gGameState = GS_FRONTEND')) {
    mainMenuLoaded = true;
    hideEngineStartingSpinner();
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_FRONTEND (Main menu ready)');
    prefetchWorldModels();
    // Warm cutscene audio and first mission early
    prefetchAssetAsync('audio/bet.mp3');
    prefetchAssetAsync('audio/c1_tex.mp3');
    prefetchAssetAsync('audio/head.wav');
    prefetchAssetAsync('audio/police.wav');
  }
  // Kick off async prefetch for any TXD mentioned in log (e.g. "casepath couldn't find X.txd")
  const txdMatch = line.match(/full path was (models\/[^\s"]+\.txd)/i);
  if (txdMatch) {
    prefetchAssetAsync(txdMatch[1].toLowerCase());
  }
  if (line.includes('gGameState = GS_PLAYING_GAME') || line.includes('[regta3] gGameState = GS_PLAYING_GAME')) {
    mainMenuLoaded = true;
    hideEngineStartingSpinner();
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_PLAYING_GAME');
    unlockWebAudio();
    prefetchAssetAsync('anim/cuts.img');
    prefetchAssetAsync('ANIM/CUTS.IMG');
    prefetchAssetAsync('audio/bet.mp3');
    prefetchAssetAsync('audio/c1_tex.mp3');
    prefetchAssetAsync('audio/head.wav');
    prefetchAssetAsync('audio/police.wav');
    prefetchAssetAsync('audio/sfx.sdt');
    return;
  }
  if (line.includes('SET_INTRO_IS_PLAYING 0') || line.includes('post-intro stream')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'CUTSCENE', 'Intro cutscene finished! Starting first mission audio prefetch');
    prefetchFirstMissionAudio();
  }
  if (line.includes('per-sample MP3 bank')) {
    prefetchHotSfxAsync();
    prefetchRadioBedsAsync();
    prefetchFirstMissionAudio();
  }
  if (line.includes('OpenAL context created') || line.includes('per-sample MP3 bank') ||
      line.includes("LoadCutsceneData('") || line.includes('START_CUTSCENE') || line.includes('preload audio')) {
    unlockWebAudio();
    const cut = line.match(/LoadCutsceneData\('([^']+)'\)/i) || line.match(/START_CUTSCENE '([^']+)'/i) || line.match(/preload audio (\S+)/i);
    if (cut && cut[1]) {
      const name = String(cut[1]).toLowerCase();
      if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'CUTSCENE', 'Cutscene event: ' + name);
      /* One prefetch — resolveAudioRel picks mp3 vs wav; no dual 404 spam. */
      prefetchAssetAsync(resolveAudioRel(`audio/${name}.mp3`));
    }
  }
  if (line.includes('gGameState = GS_INIT_PLAYING_GAME')) {
    if (typeof window.remoteLog === 'function') window.remoteLog('INFO', 'STATE', 'Game state: GS_INIT_PLAYING_GAME');
    unlockWebAudio();
    return;
  }
  if (!line.includes('[regta3]')) return;
  if (line.includes('Idle frame 0: after RenderScene')) {
    markGameStarted();
  }
}

function getOpenAlHandle() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.__regta3AL) return globalThis.__regta3AL;
    if (typeof Module !== 'undefined' && Module.AL) return Module.AL;
    if (typeof AL !== 'undefined') return AL;
  } catch (_) {}
  return null;
}

function beepOnContext(ctx) {
  if (!ctx) return;
  try {
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch (_) {}
}

function resumeAudioCtx(ctx) {
  if (!ctx) return Promise.resolve();
  try {
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') {
        return p.then(() => beepOnContext(ctx)).catch(() => {});
      }
    } else if (ctx.state === 'running') {
      beepOnContext(ctx);
    }
  } catch (_) {}
  return Promise.resolve();
}

function collectAudioContexts() {
  const out = new Set(trackedAudioContexts);
  try {
    const al = getOpenAlHandle();
    if (al && al.contexts) {
      for (const id of Object.keys(al.contexts)) {
        const c = al.contexts[id];
        if (c && c.audioCtx) out.add(c.audioCtx);
      }
    }
    if (al && al.currentCtx && al.currentCtx.audioCtx) out.add(al.currentCtx.audioCtx);
  } catch (_) {}
  return [...out];
}

function resumeOpenAlContexts() {
  try {
    if (typeof globalThis !== 'undefined' && typeof globalThis.__regta3ResumeOpenAl === 'function') {
      globalThis.__regta3ResumeOpenAl();
    }
    if (typeof Module !== 'undefined' && typeof Module.resumeRegta3Audio === 'function') {
      Module.resumeRegta3Audio();
    }
  } catch (_) {}
  return Promise.all(collectAudioContexts().map((ctx) => resumeAudioCtx(ctx)));
}

function anyAudioRunning() {
  return collectAudioContexts().some((ctx) => ctx && ctx.state === 'running');
}

function unlockWebAudio() {
  return resumeOpenAlContexts().then(() => {
    if (anyAudioRunning()) {
      audioUnlocked = true;
      hideTapHint();
    }
  });
}

function installGestureUnlock() {
  const unlock = () => {
    unlockWebAudio();
    try {
      if (canvas) canvas.focus({ preventScroll: true });
    } catch (_) {}
  };
  // Keep listening: OpenAL often creates its AudioContext after the first gesture.
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('mousedown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
}

function installPointerLockErrorSwallow() {
  // Do not gate requestPointerLock — that broke mouse look. Only swallow rejections.
  const patch = (proto) => {
    if (!proto || proto.__regta3LockSwallow) return;
    proto.__regta3LockSwallow = true;
    const orig = proto.requestPointerLock;
    if (typeof orig !== 'function') return;
    proto.requestPointerLock = function (...args) {
      try {
        const ret = orig.apply(this, args);
        if (ret && typeof ret.catch === 'function') return ret.catch(() => {});
        return ret;
      } catch (_) {
        return undefined;
      }
    };
  };
  patch(Element.prototype);
  if (canvas) patch(Object.getPrototypeOf(canvas));
}

async function loadPreloadList() {
  const res = await fetch(PRELOAD_URL);
  if (!res.ok) throw new Error(`preload list: HTTP ${res.status}`);
  const text = await res.text();
  return parsePreloadList(text);
}

function isBootDeferredAsset(rel) {
  const r = normalizeAssetRel(rel);
  /* Defer heavy background radio stations only; preload all models, cuts.img, sfx, and intro audio */
  if (r.startsWith('audio/') && !r.includes('sfx')) {
    if (/\b(bet|c1_tex|jb|end|head|police|l1_lg|l2_dsb|l3_dm|l4_pap|l5_tfb|lib_a|lib_a1|lib_a2|lib_b|lib_c|lib_d|ammu)\./i.test(r)) return false;
    if (/\.(wav|mp3)$/i.test(r)) return true;
  }
  return false;
}

function bootPreloadPriority(path) {
  const r = normalizeAssetRel(path.replace(/^gta3-assets\/local\//i, ''));
  if (/(?:^|\/)cuts\.img$/i.test(r) || /\.dir$/i.test(r) || /frontend|menu\.txd|fonts/i.test(r)) return 0;
  if (r.startsWith('data/') || r.startsWith('text/')) return 1;
  if (r.startsWith('models/coll') || r.startsWith('models/generic')) return 1;
  if (r.startsWith('models/gta3.img/')) return 2;
  if (r.startsWith('anim/') || r.startsWith('txd/')) return 2;
  return 3;
}

/* Персистентный кэш ассетов: OPFS через libopfs.js (Module.OPFS —
 * emscripten js-library, см. src/skel/emscripten/libopfs.js). Все операции
 * идут в Web Worker через createSyncAccessHandle — в отличие от
 * createWritable на main thread это работает на iOS/Safari с 15.2.
 * Файлы лежат под корнем ASSET_CACHE_NAME, зеркаля rel-путь ассета;
 * раскладка совместима с прежним main-thread бекендом. */
let opfsInitPromise = null;
function opfsInit() {
  if (opfsInitPromise) return opfsInitPromise;
  const M = window.Module;
  const api = (M && M.OPFS) ? M.OPFS : null;
  if (!api) return Promise.resolve(null); // до создания wasm-модуля кэша нет
  opfsInitPromise = (async () => {
    try {
      /* 'list' обязателен до read/write: он заводит корень в
       * rootDirectoryCache воркера (иначе getMeta/updateMeta бросают). */
      const entries = await api.opfsList(ASSET_CACHE_NAME);
      console.log('[regta3] OPFS cache (worker):', Object.keys(entries).length, 'entries');
      /* одноразовая уборка прежних бекендов: CacheStorage и старый
       * OPFS-корень main-thread реализации */
      if (navigator.storage && navigator.storage.getDirectory) {
        navigator.storage.getDirectory()
          .catch(() => {});
      }
      return api;
    } catch (e) {
      console.warn('[regta3] OPFS unavailable:', e && e.message ? e.message : e);
      return null;
    }
  })();
  return opfsInitPromise;
}

async function opfsReadAsset(rel) {
  return null;
}

async function opfsWriteAsset(rel, data) {
  // Direct local server serving; no OPFS worker IPC overhead needed
}

function cacheAssetData(rel, data) {
  assetDataCache.set(normalizeAssetRel(rel), data);
}

function getCachedAsset(rel) {
  return assetDataCache.get(normalizeAssetRel(rel));
}

async function readResponseBytes(res, onProgress) {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (onProgress) onProgress(buf.length, buf.length);
  return buf;
}

const ASSET_CACHE_KEY = 'gta3-assets-v2';
let cacheStoragePromise = null;
async function getCacheStorage() {
  if (cacheStoragePromise) return cacheStoragePromise;
  if (typeof caches === 'undefined') return null;
  cacheStoragePromise = caches.open(ASSET_CACHE_KEY).catch(() => null);
  return cacheStoragePromise;
}

async function fetchAsset(relPath, onProgress) {
  const cached = getCachedAsset(relPath);
  if (cached) {
    if (onProgress) onProgress(cached.length, cached.length);
    return cached;
  }
  const nKey = normalizeAssetRel(relPath);
  if (nKey === 'audio/sfx.raw' || nKey.endsWith('/sfx.raw')) {
    throw new Error(`asset ${relPath}: directory, not a file`);
  }
  const bases = ASSET_BASES_WORKING;
  const cache = await getCacheStorage();
  
  let lastErr;
  for (const base of bases) {
    const url = base + relPath;
    try {
      if (cache) {
        try {
          const cachedRes = await cache.match(url);
          if (cachedRes) {
            const data = new Uint8Array(await cachedRes.arrayBuffer());
            cacheAssetData(relPath, data);
            if (onProgress) onProgress(data.length, data.length);
            return data;
          }
        } catch (_) {}
      }
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`asset ${relPath}: HTTP ${res.status}`);
        continue;
      }
      const data = await readResponseBytes(res, onProgress);
      cacheAssetData(relPath, data);
      if (cache) {
        try {
          const respToCache = new Response(data.slice(0), {
            headers: { 'Content-Type': 'application/octet-stream' }
          });
          cache.put(url, respToCache).catch(() => {});
        } catch (_) {}
      }
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`asset ${relPath}: fetch failed`);
}

async function runPool(items, concurrency, workerFn) {
  let cursor = 0;
  const workers = [];
  const n = Math.min(concurrency, Math.max(1, items.length));
  for (let w = 0; w < n; w++) {
    workers.push((async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await workerFn(items[i], i);
      }
    })());
  }
  await Promise.all(workers);
}

function normalizeAssetRel(rel) {
  return String(rel).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function isTextureProbe(rel) {
  const r = normalizeAssetRel(rel);
  if (!/\.(tga|bmp|png)$/i.test(r)) return false;
  // Internal texture raster names (from materials inside TXDs) are bare or oddly named like "xxx_128.tga", "$$".tga etc.
  // Real asset files that happen to end in .bmp (e.g. player.bmp) or under generic/ must still be loadable if listed.
  if (/\/(generic|misc)\//i.test(r) || /player\./i.test(r) || /fonts/i.test(r)) return false;
  if (/^[^/]+\.(tga|bmp|png)$/i.test(r)) return true; // bare name -> likely internal probe
  // Conservative: other .tga/.png under models/ that are not our known loose UI ones are probes
  return true;
}

function shouldAvoidNetworkForAsset(rel) {
  const r = normalizeAssetRel(rel);
  if (isTextureProbe(r)) return true;
  /* Монолитный SFX-банк (80МБ) сознательно не доставляем: без него sampman
   * включает пофайловый mp3-режим (_emscriptenMp3Sfx). */
  if (r === 'audio/sfxbank.raw') return true;
  // reVCDOS-style resources are extracted from IMG archives into directories
  // and can be loaded on demand as ordinary files.
  return false;
}

function toAssetPath(file) {
  let path = String(file).replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!path.startsWith(`${ASSET_PREFIX}/`)) {
    path = `${ASSET_PREFIX}/${path.replace(/^\/+/, '')}`;
  }
  return path.toLowerCase();
}

function assetCandidates(rel) {
  const r0 = normalizeAssetRel(rel);
  /* Remap wrong audio extension before building the candidate list. */
  const r = (r0.startsWith('audio/') && !r0.includes('sfx')) ? resolveAudioRel(r0) : r0;
  const out = [];
  const add = (path) => {
    const n = normalizeAssetRel(path);
    if (!out.includes(n)) out.push(n);
  };

  // Prefer the requested path first; unpacked gta3.img/ is a fallback (reVCDOS layout).
  add(r);

  let m = r.match(/^models\/([^/]+\.(dff|txd|col|ifp))$/);
  if (m) add(`models/gta3.img/${m[1]}`);

  m = r.match(/^models\/([^/]+)\/([^/]+\.(dff|txd|col|ifp))$/);
  if (m && m[1] !== 'gta3.img' && m[1] !== 'coll' && m[1] !== 'generic') {
    add(`models/gta3.img/${m[2]}`);
  }

  m = r.match(/^([^/]+\.(txd|dff))$/);
  if (m) {
    add(`txd/${m[1]}`);
    add(`models/${m[1]}`);
  }

  if (r.endsWith('.dir')) {
    const base = r.slice(0, -4);
    if (base.endsWith('gta3_archive')) add('models/gta3.dir');
    if (base.endsWith('gta3')) add('models/gta3_archive.dir');
    if (base.endsWith('cuts')) add('anim/cuts.dir');
  }

  if (r.endsWith('cuts.img') || r.endsWith('cuts.IMG')) {
    add('anim/cuts.img');
    add('ANIM/CUTS.IMG');
  }

  /* Do NOT add alternate .wav/.mp3 — every stem has exactly one format on disk. */

  /* Intro convoy recordings: bare chaseN.dat after SetDir("data/paths"). */
  m = r.match(/^chase(\d+)\.dat$/i);
  if (m) add(`data/paths/chase${m[1]}.dat`);
  m = r.match(/^data\/paths\/chase(\d+)\.dat$/i);
  if (m) add(`chase${m[1]}.dat`);

  if (r === 'userfiles/gta3.set' || r.endsWith('/userfiles/gta3.set')) {
    add('gta3.set');
  }

  return out;
}

async function fetchFirstAvailable(candidates, onProgress) {
  let lastErr;
  for (const rel of candidates) {
    try {
      return { rel, data: await fetchAsset(rel, onProgress) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('no asset candidates');
}

function vfsPathExists(Module, vfsPath) {
  try {
    return Module.FS.analyzePath(vfsPath).exists;
  } catch (_) {
    return false;
  }
}

function writeAssetToFs(Module, path, data) {
  const vfsPath = '/' + path.replace(/^\/+/, '');
  const dir = vfsPath.substring(0, vfsPath.lastIndexOf('/'));
  Module.FS.mkdirTree(dir);
  Module.FS.writeFile(vfsPath, data);
}

function ensureGameDirs(Module) {
  const dirs = [
    `/${ASSET_PREFIX}/userfiles`,
    `/${ASSET_PREFIX}/skins`,
    `/${ASSET_PREFIX}/audio`,
    `/${ASSET_PREFIX}/audio/sfx.raw`,
    `/${ASSET_PREFIX}/data`,
    `/${ASSET_PREFIX}/data/paths`,
    `/${ASSET_PREFIX}/data/maps`,
    `/${ASSET_PREFIX}/models`,
    `/${ASSET_PREFIX}/models/coll`,
    `/${ASSET_PREFIX}/models/generic`,
    `/${ASSET_PREFIX}/models/gta3.img`,
    `/${ASSET_PREFIX}/anim`,
    `/${ASSET_PREFIX}/ANIM`,
    `/${ASSET_PREFIX}/txd`,
    `/${ASSET_PREFIX}/text`,
    '/userfiles',
    '/skins',
    '/audio',
    '/audio/sfx.raw',
    '/data',
    '/data/paths',
    '/data/maps',
    '/models',
    '/models/coll',
    '/models/generic',
    '/models/gta3.img',
    '/anim',
    '/ANIM',
    '/txd',
    '/text',
  ];
  for (const dir of dirs) {
    try { Module.FS.mkdirTree(dir); } catch (_) {}
  }
  installFsLogging(Module);
}

function installFsLogging(Module) {
  if (!Module || !Module.FS || Module.FS.__loggingInstalled) return;
  Module.FS.__loggingInstalled = true;
  const origOpen = Module.FS.open;
  if (origOpen) {
    Module.FS.open = function (path, flags, mode) {
      const p = String(path);
      try {
        const stream = origOpen.apply(this, arguments);
        if (p.endsWith('.dff') || p.endsWith('.txd') || p.endsWith('.col') || p.endsWith('.mp3') || p.endsWith('.wav') || p.endsWith('.dat') || p.endsWith('.ide') || p.endsWith('.ipl') || p.endsWith('.img') || p.endsWith('.dir')) {
          if (typeof window.remoteLog === 'function') window.remoteLog('DEBUG', 'VFS', 'open OK: ' + p);
        }
        return stream;
      } catch (err) {
        if (!isExpectedAssetMiss(p)) {
          if (typeof window.remoteLog === 'function') window.remoteLog('WARN', 'VFS', 'open FAIL: ' + p + ' (' + (err && err.message ? err.message : err) + ')');
        }
        throw err;
      }
    };
  }
}

function isExpectedAssetMiss(vfsPath) {
  const p = String(vfsPath || '').toLowerCase();
  return (
    p.includes('sound.cache') ||
    p.includes('sfxbank') ||
    p.includes('$$') ||
    p.endsWith('.tga') ||
    p.endsWith('.bmp') ||
    p.endsWith('.png') ||
    p.endsWith('.tif') ||
    isWrongAudioFormat(p.replace(/^\/gta3-assets\/local\//i, ''))
  );
}

/* Облачные сейвы (jsdos-cloud-sdk): userfiles живут в IDBFS, а CloudSDKUI
 * умеет целиком выгружать/восстанавливать IndexedDB-базу этого маунта
 * (имя базы у emscripten = точка монтирования). Порядок: pull ДО
 * FS.syncfs(true) — тогда populate уже видит облачные файлы; push — после
 * каждого успешного FS.syncfs(false). Дедупликация неизменённых пушей —
 * внутри SDK (fingerprint сериализованной базы). */
const CLOUD_SAVE_FILE = 'regta3dos.userfiles.idbfs';
const USERFILES_MOUNT = `/${ASSET_PREFIX}/userfiles`;
let cloudUiPromise = null;
let cloudPushInFlight = false;

function mountCloudUi() {
  if (cloudUiPromise) return cloudUiPromise;
  if (typeof CloudSDKUI === 'undefined') {
    cloudUiPromise = Promise.resolve(false);
    return cloudUiPromise;
  }
  /* mount() резолвится, когда виджет узнал состояние ключа (в т.ч. premium) —
   * до этого pullIDBFSStorage всегда бросает "not logged in". */
  cloudUiPromise = CloudSDKUI.mount().then(() => true).catch((err) => {
    console.warn('[regta3] cloud saves UI failed:', err && err.message ? err.message : err);
    return false;
  });
  return cloudUiPromise;
}

function maybeCloudPush() {
  if (typeof CloudSDKUI === 'undefined' || cloudPushInFlight) return;
  cloudPushInFlight = true;
  /* pushIDBFSStorage не бросает: true — облако, false — только локально
   * (нет ключа/подписки/сети); виджет показывает результат сам. */
  CloudSDKUI.pushIDBFSStorage(CLOUD_SAVE_FILE, USERFILES_MOUNT).then((saved) => {
    console.log('[regta3] cloud push:', saved ? 'saved in cloud' : 'saved locally');
  }).catch(() => {}).finally(() => {
    cloudPushInFlight = false;
  });
}

async function pullCloudSaves() {
  const uiOk = await mountCloudUi();
  if (!uiOk) return;
  try {
    const restored = await CloudSDKUI.pullIDBFSStorage(CLOUD_SAVE_FILE, USERFILES_MOUNT);
    console.log('[regta3] cloud pull:', restored ? 'restored from cloud' : 'nothing in cloud yet');
  } catch (err) {
    /* не залогинен / нет premium — остаёмся на локальных сейвах */
    console.log('[regta3] cloud pull skipped:', err && err.message ? err.message : err);
  }
}

async function mountUserfilesIdbfs(Module) {
  const mountPath = USERFILES_MOUNT;
  try { Module.FS.mkdirTree(mountPath); } catch (_) {}
  if (!Module.FS.filesystems || !Module.FS.filesystems.IDBFS) {
    console.warn('[regta3] IDBFS unavailable — saves will not persist across reload');
    return false;
  }
  try {
    Module.FS.mount(Module.FS.filesystems.IDBFS, {}, mountPath);
  } catch (err) {
    console.warn('[regta3] IDBFS mount failed:', err && err.message ? err.message : err);
    return false;
  }
  /* Сначала облако → IndexedDB, затем populate IndexedDB → MEMFS. */
  await pullCloudSaves();
  return new Promise((resolve) => {
    Module.FS.syncfs(true, (err) => {
      if (err) {
        console.warn('[regta3] IDBFS populate failed:', err);
        resolve(false);
        return;
      }
      console.log('[regta3] IDBFS userfiles ready');
      resolve(true);
    });
  });
}

function scheduleUserfilesPersist(Module) {
  if (!Module.FS.filesystems || !Module.FS.filesystems.IDBFS) return;
  let pending = false;
  /* Страховка от облачного pull: pullIDBFSStorage заменяет базу маунта
   * целиком, и снапшот без re3.ini (старая версия / другое устройство)
   * выкидывает настройки. Бэкап в localStorage — источник для повторного
   * сеяния (см. re3Ini выше) вместо голых дефолтов. */
  const backupRe3Ini = () => {
    try {
      const data = Module.FS.readFile(`${USERFILES_MOUNT}/re3.ini`, { encoding: 'utf8' });
      if (data && data.length > 0) localStorage.setItem('regta3dos.re3.ini', data);
    } catch (_) {}
  };
  const flush = () => {
    if (pending) return;
    pending = true;
    backupRe3Ini();
    try {
      Module.FS.syncfs(false, (err) => {
        pending = false;
        if (err) {
          console.warn('[regta3] IDBFS flush failed:', err);
          return;
        }
        maybeCloudPush();
      });
    } catch (err) {
      pending = false;
    }
  };
  setInterval(flush, 20000);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  Module.persistUserfiles = flush;
}

function scheduleRe3IniPersist(Module) {
  // Joypad bindings and the detected-joystick name are saved to re3.ini
  // (SaveINIControllerSettings), not to the IDBFS-backed gta3.set — so copy the
  // ini back to localStorage, otherwise controller setup dies on reload.
  const iniPath = `/${ASSET_PREFIX}/re3.ini`;
  const save = () => {
    try {
      if (!vfsPathExists(Module, iniPath)) return;
      const data = Module.FS.readFile(iniPath, { encoding: 'utf8' });
      if (data && data.length > 0) localStorage.setItem('regta3dos.re3.ini', data);
    } catch (err) {
      console.warn('[regta3] re3.ini persist failed:', err && err.message ? err.message : err);
    }
  };
  setInterval(save, 20000);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  Module.persistRe3Ini = save;
}

function looksLikeHtmlDirectoryListing(data) {
  if (!data || data.length < 15) return false;
  const head = String.fromCharCode(...data.subarray(0, Math.min(64, data.length))).toLowerCase();
  return head.includes('<!doctype') || head.includes('<html');
}

// Background async prefetch for assets we know will be needed
// (avoids sync XHR blocking the main thread on future frames)
const prefetchPending = new Set();
function prefetchAssetAsync(rel) {
  const resolved = (normalizeAssetRel(rel).startsWith('audio/') && !normalizeAssetRel(rel).includes('sfx'))
    ? resolveAudioRel(rel) : normalizeAssetRel(rel);
  const nKey = normalizeAssetRel(resolved);
  if (shouldAvoidNetworkForAsset(resolved) || assetNotFound.has(nKey) || assetDataCache.has(nKey) || prefetchPending.has(nKey)) return;
  /* Engine asked for wrong extension — do not hit the network for it. */
  if (isWrongAudioFormat(rel)) {
    assetNotFound.add(normalizeAssetRel(rel));
  }
  prefetchPending.add(nKey);
  fetchFirstAvailable(assetCandidates(resolved)).then(({ rel: usedRel, data }) => {
    cacheAssetData(usedRel, data);
    cacheAssetData(resolved, data);
    recordStreamedPreload(usedRel);
    const Module = window.Module;
    if (Module && Module.FS) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${usedRel}`, data); } catch (_) {}
      if (usedRel !== resolved) {
        try { writeAssetToFs(Module, `${ASSET_PREFIX}/${resolved}`, data); } catch (_) {}
      }
    }
  }).catch(() => {
    assetNotFound.add(nKey);
  });
}

/* Единственный канал доставки для C++ (regta3_js_prefetch_asset): OPFS →
 * сеть → OPFS-кэш → MEMFS, без блокировок. Итог фиксируется в
 * asyncFileStatus, чтобы C++ (regta3_wait_file) мог возобновиться сразу,
 * в т.ч. по 404. Дедуплицирует параллельные запросы по пути. */
const loadAsyncFilePending = new Map();
const asyncFileStatus = new Map(); // key -> 'pending' | 'ok' | 'notfound'
let reportLoadProgressLast = 0;
let reportLoadProgressShown = false;
function loadAsyncFile(vfsPath) {
  const key = String(vfsPath).toLowerCase();
  const inflight = loadAsyncFilePending.get(key);
  if (inflight) return inflight;
  asyncFileStatus.set(key, 'pending');
  const p = loadAsyncFileInner(vfsPath)
    .catch(() => false)
    .then((ok) => {
      asyncFileStatus.set(key, ok ? 'ok' : 'notfound');
      return ok;
    })
    .finally(() => loadAsyncFilePending.delete(key));
  loadAsyncFilePending.set(key, p);
  return p;
}

/* Синхронный статус для C++-опроса (regta3_js_file_status):
 * 0 = неизвестно/качается, 1 = есть, 2 = точно нет (404/проба). */
function getAsyncFileStatus(vfsPath) {
  const Module = window.Module;
  const key = String(vfsPath).toLowerCase();
  const normalized = '/' + key.replace(/^\/+/, '');
  if (Module && Module.FS && vfsPathExists(Module, normalized)) return 1;
  const rel = normalizeAssetRel(normalized.replace(/^\/gta3-assets\/local\//i, ''));
  const st = asyncFileStatus.get(key);
  if (st === 'ok') return 1;
  if (st === 'notfound') return 2;
  /* синхронно известные отказы — пробы текстур и кэшированные 404 */
  if (shouldAvoidNetworkForAsset(rel) || assetNotFound.has(rel)) return 2;
  return 0;
}

async function loadAsyncFileInner(vfsPath) {
  const Module = window.Module;
  if (!Module || !Module.FS) return false;
  const normalized = '/' + String(vfsPath).replace(/^\/+/, '').toLowerCase();
  if (vfsPathExists(Module, normalized)) return true;
  let rel = normalized.replace(/^\/gta3-assets\/local\//i, '');
  let aliasWrongExt = null;
  if (rel.startsWith('audio/') && !rel.includes('sfx')) {
    const fixed = resolveAudioRel(rel);
    if (fixed !== rel) {
      aliasWrongExt = normalizeAssetRel(rel);
      rel = fixed;
      const fixedVfs = `/${ASSET_PREFIX}/${fixed}`;
      if (vfsPathExists(Module, fixedVfs)) {
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, Module.FS.readFile(fixedVfs));
        } catch (_) {}
        return true;
      }
    }
  }
  if (shouldAvoidNetworkForAsset(rel)) return false;
  const candidates = assetCandidates(rel);
  for (const c of candidates) {
    if (c !== rel && vfsPathExists(Module, `/${ASSET_PREFIX}/${c}`)) {
      try {
        const data = Module.FS.readFile(`/${ASSET_PREFIX}/${c}`);
        writeAssetToFs(Module, `${ASSET_PREFIX}/${rel}`, data);
        if (aliasWrongExt) writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, data);
        return true;
      } catch (_) {}
    }
  }
  if (assetNotFound.has(normalizeAssetRel(rel)) &&
      candidates.every((c) => assetNotFound.has(normalizeAssetRel(c)))) {
    return false;
  }
  try {
    const { rel: usedRel, data } = await fetchFirstAvailable(candidates);
    cacheAssetData(usedRel, data);
    recordStreamedPreload(usedRel);
    writeAssetToFs(Module, `${ASSET_PREFIX}/${usedRel}`, data);
    if (usedRel !== rel) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${rel}`, data); } catch (_) {}
    }
    if (aliasWrongExt && aliasWrongExt !== usedRel) {
      try { writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasWrongExt}`, data); } catch (_) {}
    }
    return true;
  } catch (err) {
    assetNotFound.add(normalizeAssetRel(rel));
    console.warn('[regta3] loadAsyncFile miss:', rel, err && err.message ? err.message : err);
    return false;
  }
}

/* Common UI / footsteps / weapons / fire — first-play sync XHR hurts less if warm. */
const HOT_SFX_IDS = [
  10, 11, 15, 16, 18, 19, 21, 22, 29, 30, 32, 33, 34, 35, 36,
  103, 104, 105, 106, 107, 116, 117, 118, 119, 120,
  141, 142, 143, 144, 148, 157, 188,
  284, 285, 287, 288, 294, 295, 297, 298,
  338, 339, 343, 344, 357, 358, 359, 372, 373, 374, 375, 376, 377, 378, 379,
];
let hotSfxPrefetchStarted = false;
function prefetchHotSfxAsync() {
  if (hotSfxPrefetchStarted) return;
  hotSfxPrefetchStarted = true;
  let i = 0;
  const pump = () => {
    const batch = 6;
    for (let n = 0; n < batch && i < HOT_SFX_IDS.length; n++, i++) {
      prefetchAssetAsync(`audio/sfx.raw/${HOT_SFX_IDS[i]}.mp3`);
    }
    if (i < HOT_SFX_IDS.length) {
      setTimeout(pump, 40);
    } else {
      console.log(`[regta3] SFX prefetch queued: ${HOT_SFX_IDS.length} samples`);
    }
  };
  setTimeout(pump, 100);
}

/* 7–27MB radio beds — never sync-XHR; warm them in background after boot. */
const RADIO_BED_NAMES = [
  'head', 'class', 'kjah', 'rise', 'lips', 'game', 'msx', 'flash', 'chat',
  'police', 'city', 'water',
];
let radioBedPrefetchStarted = false;
function prefetchRadioBedsAsync() {
  if (radioBedPrefetchStarted) return;
  radioBedPrefetchStarted = true;
  for (const n of RADIO_BED_NAMES) {
    prefetchAssetAsync(`audio/${n}.wav`);
  }
  console.log('[regta3] radio beds prefetch started');
}

/* First story mission (Luigi's Girls) — warm cutscene bed + early dialogue
 * before the player reaches the club, while post-intro streaming is busy. */
const FIRST_MISSION_AUDIO = [
  'audio/l1_lg.mp3',
  'audio/lib_a.wav', 'audio/lib_a1.wav', 'audio/lib_a2.wav',
  'audio/lib_b.wav', 'audio/lib_c.wav', 'audio/lib_d.wav',
  'audio/l2_a.wav', 'audio/ammu_a.wav', 'audio/ammu_b.wav', 'audio/ammu_c.wav',
];
let firstMissionAudioPrefetchStarted = false;
function prefetchFirstMissionAudio() {
  if (firstMissionAudioPrefetchStarted) return;
  firstMissionAudioPrefetchStarted = true;
  for (const rel of FIRST_MISSION_AUDIO)
    prefetchAssetAsync(rel);
  console.log('[regta3] first-mission audio prefetch started');
}

/* ===================== Тач-управление =====================
 * Игра о существовании тача не знает ни одной строкой C++-кода. Оверлей
 * из DOM жмёт эмулированный «стандартный» геймпад (gamepad-emulator.js),
 * тот патчит navigator.getGamepads, emscripten_sample_gamepad_data
 * перечитывает её каждый семпл — и дальше это обычный джойстик:
 * Regta3Joy* → CapturePad → PCTempJoyState → штатные биндинги.
 * Обратно игра шлёт своё состояние (regta3_js_touch_state) в data-state-*
 * на <body>, а CSS перекрашивает и переставляет те же самые div'ы.
 * Подробности — touch-controls/TOUCH_CONTROLS.md. */

/* wantsTouchControls and isTouchDevice are declared at the top of game.js */

/* ==========================================================================
 * GTA III 10TH ANNIVERSARY MOBILE CONTROLS SYSTEM
 * Authentic 2011 iOS/Android control layer for Open GTA III (re3.wasm)
 * ========================================================================== */

const TOUCH_BTN = {
  A: 0, B: 1, X: 2, Y: 3,
  LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
};

let touchEmulator = null;
let touchPadIndex = -1;

const ControlState = {
  ON_FOOT: 'ON_FOOT',
  DRIVING: 'DRIVING',
  DRIVE_BY: 'DRIVE_BY',
  SPECIAL_VEHICLE: 'SPECIAL_VEHICLE',
  MENU: 'MENU',
};

/**
 * MobileControlState: Tracks reference-counted input actions and translates
 * them into KeyboardEvents, MouseEvents, and GamepadEmulator actions.
 */
class MobileControlState {
  constructor() {
    this.actionSources = new Map();
    this.activeActions = new Set();
    this.joyX = 0;
    this.joyY = 0;

    this.keyDefinitions = {
      forward: {
        keys: [{ key: 'w', code: 'KeyW', keyCode: 87 }, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }],
        gpBtn: TOUCH_BTN.A
      },
      reverse: {
        keys: [{ key: 's', code: 'KeyS', keyCode: 83 }, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }],
        gpBtn: TOUCH_BTN.X
      },
      steerLeft: {
        keys: [{ key: 'a', code: 'KeyA', keyCode: 65 }, { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 }],
        gpBtn: TOUCH_BTN.DPAD_LEFT
      },
      steerRight: {
        keys: [{ key: 'd', code: 'KeyD', keyCode: 68 }, { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }],
        gpBtn: TOUCH_BTN.DPAD_RIGHT
      },
      attack: {
        keys: [{ key: 'Control', code: 'ControlLeft', keyCode: 17 }, { key: '0', code: 'Numpad0', keyCode: 96 }],
        gpBtn: TOUCH_BTN.B
      },
      jump: {
        keys: [{ key: ' ', code: 'Space', keyCode: 32 }],
        gpBtn: TOUCH_BTN.X
      },
      sprint: {
        keys: [{ key: 'Shift', code: 'ShiftLeft', keyCode: 16 }],
        gpBtn: TOUCH_BTN.A
      },
      enterExit: {
        keys: [{ key: 'f', code: 'KeyF', keyCode: 70 }, { key: 'Enter', code: 'Enter', keyCode: 13 }],
        gpBtn: TOUCH_BTN.Y
      },
      handbrake: {
        keys: [{ key: ' ', code: 'Space', keyCode: 32 }],
        gpBtn: TOUCH_BTN.RB
      },
      horn: {
        keys: [{ key: 'Shift', code: 'ShiftLeft', keyCode: 16 }],
        gpBtn: TOUCH_BTN.L3
      },
      radio: {
        keys: [{ key: 'r', code: 'KeyR', keyCode: 82 }, { key: 'Insert', code: 'Insert', keyCode: 45 }],
        gpBtn: TOUCH_BTN.LB
      },
      job: {
        keys: [{ key: 'CapsLock', code: 'CapsLock', keyCode: 20 }, { key: '+', code: 'NumpadAdd', keyCode: 107 }],
        gpBtn: TOUCH_BTN.R3
      },
      camera: {
        keys: [{ key: 'v', code: 'KeyV', keyCode: 86 }, { key: 'c', code: 'KeyC', keyCode: 67 }, { key: 'Home', code: 'Home', keyCode: 36 }],
        gpBtn: TOUCH_BTN.BACK
      },
      lookLeft: {
        keys: [{ key: 'q', code: 'KeyQ', keyCode: 81 }, { key: '4', code: 'Numpad4', keyCode: 100 }]
      },
      lookRight: {
        keys: [{ key: 'e', code: 'KeyE', keyCode: 69 }, { key: '2', code: 'Numpad2', keyCode: 98 }]
      },
      lookBehind: {
        keys: [{ key: 'CapsLock', code: 'CapsLock', keyCode: 20 }, { key: '.', code: 'NumpadDecimal', keyCode: 110 }]
      },
      weaponNext: {
        keys: [{ key: 'Enter', code: 'Enter', keyCode: 13 }],
        gpBtn: TOUCH_BTN.RT
      },
      weaponPrev: {
        keys: [{ key: '.', code: 'NumpadDecimal', keyCode: 110 }]
      },
      menu: {
        keys: [{ key: 'Escape', code: 'Escape', keyCode: 27 }],
        gpBtn: TOUCH_BTN.START
      }
    };
  }

  set(actionName, sourceId, isDown) {
    if (!this.actionSources.has(actionName)) {
      this.actionSources.set(actionName, new Set());
    }
    const sources = this.actionSources.get(actionName);
    const wasActive = sources.size > 0;

    if (isDown) {
      sources.add(sourceId);
    } else {
      sources.delete(sourceId);
    }

    const isActive = sources.size > 0;
    if (isActive !== wasActive) {
      if (isActive) {
        this.activeActions.add(actionName);
      } else {
        this.activeActions.delete(actionName);
      }
      this._applyActionState(actionName, isActive);
    }
  }

  tap(actionName) {
    this.set(actionName, 'tap', true);
    setTimeout(() => this.set(actionName, 'tap', false), 50);
  }

  setJoystick(nx, ny) {
    this.joyX = nx;
    this.joyY = ny;

    if (touchEmulator && touchPadIndex >= 0) {
      try {
        touchEmulator.MoveAxis(touchPadIndex, 0, nx);
        touchEmulator.MoveAxis(touchPadIndex, 1, ny);
      } catch (_) {}
    }

    this.set('forward', 'joy_y', ny < -0.22);
    this.set('reverse', 'joy_y', ny > 0.22);
    this.set('steerLeft', 'joy_x', nx < -0.22);
    this.set('steerRight', 'joy_x', nx > 0.22);
  }

  resetJoystick() {
    this.joyX = 0;
    this.joyY = 0;
    if (touchEmulator && touchPadIndex >= 0) {
      try {
        touchEmulator.MoveAxis(touchPadIndex, 0, 0);
        touchEmulator.MoveAxis(touchPadIndex, 1, 0);
      } catch (_) {}
    }
    this.set('forward', 'joy_y', false);
    this.set('reverse', 'joy_y', false);
    this.set('steerLeft', 'joy_x', false);
    this.set('steerRight', 'joy_x', false);
  }

  releaseAll() {
    this.resetJoystick();
    for (const [actionName, sources] of this.actionSources.entries()) {
      if (sources.size > 0) {
        sources.clear();
        this._applyActionState(actionName, false);
      }
    }
    this.activeActions.clear();
  }

  _applyActionState(actionName, isDown) {
    const def = this.keyDefinitions[actionName];
    if (!def) return;

    const eventType = isDown ? 'keydown' : 'keyup';
    if (def.keys) {
      for (const k of def.keys) {
        const ev = new KeyboardEvent(eventType, {
          key: k.key,
          code: k.code,
          keyCode: k.keyCode,
          which: k.keyCode,
          bubbles: true,
          cancelable: true
        });
        window.dispatchEvent(ev);
        if (canvas) canvas.dispatchEvent(ev);
      }
    }

    if (touchEmulator && touchPadIndex >= 0 && def.gpBtn !== undefined) {
      try {
        touchEmulator.PressButton(touchPadIndex, def.gpBtn, isDown ? 1 : 0, isDown);
      } catch (_) {}
    }
  }
}

const mobileControls = new MobileControlState();

/**
 * ControlStateMachine: Manages explicit GTA III gameplay states:
 * ON_FOOT, DRIVING, DRIVE_BY, SPECIAL_VEHICLE, MENU.
 */
class ControlStateMachine {
  constructor() {
    this.currentState = ControlState.ON_FOOT;
    this.previousState = null;
    this.flags = 0;
    this.nearCar = false;
  }

  updateFromFlags(flags) {
    this.flags = flags;
    const isMenu = !!(flags & (1 << 0));
    const isCutscene = !!(flags & (1 << 1));
    const isCar = !!(flags & (1 << 2));
    const isCarGun = !!(flags & (1 << 4));
    const isJob = !!(flags & (1 << 5));
    const isVehGun = !!(flags & (1 << 6));

    let nextState = ControlState.ON_FOOT;

    if (isMenu || isCutscene) {
      nextState = ControlState.MENU;
    } else if (isCar) {
      if (isCarGun) {
        nextState = ControlState.DRIVE_BY;
      } else if (isVehGun || isJob) {
        nextState = ControlState.SPECIAL_VEHICLE;
      } else {
        nextState = ControlState.DRIVING;
      }
    } else {
      nextState = ControlState.ON_FOOT;
    }

    if (nextState !== this.currentState) {
      this.transitionTo(nextState);
    }

    this.updateContextualButtons();
  }

  transitionTo(nextState) {
    this.previousState = this.currentState;
    this.currentState = nextState;

    // Deterministic cleanup: release all held touch inputs across state transitions
    mobileControls.releaseAll();

    const rootEl = document.getElementById('touch-controls');
    if (rootEl) {
      rootEl.dataset.touchState = nextState;
      rootEl.dataset.touchStateLower = nextState.toLowerCase();
    }
    document.body.dataset.touchState = nextState;
    document.body.dataset.touchStateLower = nextState.toLowerCase();

    if (nextState === ControlState.MENU) {
      if (isTouchDevice) disableVirtualPointerLock();
    } else {
      if (isTouchDevice) enableVirtualPointerLock();
    }
  }

  setNearCar(near) {
    if (this.nearCar !== near) {
      this.nearCar = near;
      this.updateContextualButtons();
    }
  }

  updateContextualButtons() {
    const enterCarBtn = document.getElementById('btn-enter-car');
    if (enterCarBtn) {
      const showEnter = (this.currentState === ControlState.ON_FOOT) && this.nearCar;
      enterCarBtn.classList.toggle('visible', showEnter);
    }

    const subMissionBtn = document.getElementById('btn-sub-mission');
    if (subMissionBtn) {
      const showJob = (this.currentState === ControlState.DRIVING || this.currentState === ControlState.SPECIAL_VEHICLE) && !!(this.flags & (1 << 5));
      subMissionBtn.classList.toggle('visible', showJob);
    }

    const turretFireBtn = document.getElementById('btn-turret-fire');
    if (turretFireBtn) {
      const showTurret = (this.currentState === ControlState.SPECIAL_VEHICLE) && !!(this.flags & (1 << 6));
      turretFireBtn.classList.toggle('visible', showTurret);
    }
  }
}

const controlStateMachine = new ControlStateMachine();

/**
 * Dynamic / Floating Virtual Movement Joystick (Left Thumb, On-Foot)
 */
function initFloatingJoystick() {
  const zone = document.getElementById('touch-joystick-zone');
  const base = document.getElementById('touch-joystick-base');
  const knob = document.getElementById('touch-joystick-knob');
  if (!zone || !base || !knob) return;

  let activePointerId = null;
  let originX = 0;
  let originY = 0;

  function updateJoystick(clientX, clientY) {
    const dx = clientX - originX;
    const dy = clientY - originY;
    const dist = Math.hypot(dx, dy);

    const maxVisual = 45;
    const deadzone = 8;
    const maxRadius = 55;

    const clampedDist = Math.min(dist, maxRadius);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * (clampedDist / maxRadius) * maxVisual;
    const ky = Math.sin(angle) * (clampedDist / maxRadius) * maxVisual;
    knob.style.transform = 'translate(calc(-50% + ' + kx.toFixed(1) + 'px), calc(-50% + ' + ky.toFixed(1) + 'px))';

    if (dist < deadzone) {
      mobileControls.setJoystick(0, 0);
      return;
    }

    const norm = Math.min(1.0, (dist - deadzone) / (maxRadius - deadzone));
    const nx = Math.cos(angle) * norm;
    const ny = Math.sin(angle) * norm;
    mobileControls.setJoystick(nx, ny);
  }

  function resetJoystick() {
    activePointerId = null;
    zone.classList.remove('touching');
    base.classList.remove('active');
    base.style.left = '';
    base.style.top = '';
    knob.style.transform = 'translate(-50%, -50%)';
    mobileControls.resetJoystick();
  }

  zone.addEventListener('pointerdown', (e) => {
    if (controlStateMachine.currentState !== ControlState.ON_FOOT) return;
    if (activePointerId !== null) return;

    e.preventDefault();
    e.stopPropagation();

    activePointerId = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch (_) {}

    originX = e.clientX;
    originY = e.clientY;

    base.style.left = originX + 'px';
    base.style.top = originY + 'px';
    base.classList.add('active');
    zone.classList.add('touching');

    updateJoystick(e.clientX, e.clientY);
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      updateJoystick(e.clientX, e.clientY);
    }
  });

  const onEnd = (e) => {
    if (e.pointerId === activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      try { zone.releasePointerCapture(e.pointerId); } catch (_) {}
      resetJoystick();
    }
  };

  zone.addEventListener('pointerup', onEnd);
  zone.addEventListener('pointercancel', onEnd);
  zone.addEventListener('lostpointercapture', onEnd);
}

/**
 * Touch Camera Orbit Drag Layer
 * Independent touch gestures over the gameplay canvas.
 */
function initTouchCameraLayer() {
  const cameraLayer = document.getElementById('touch-camera-layer');
  if (!cameraLayer) return;

  let lookPointerId = null;
  let lastX = 0;
  let lastY = 0;

  cameraLayer.addEventListener('pointerdown', (e) => {
    if (controlStateMachine.currentState === ControlState.MENU) return;
    if (lookPointerId !== null) return;

    e.preventDefault();
    lookPointerId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;

    enableVirtualPointerLock();
    try { cameraLayer.setPointerCapture(e.pointerId); } catch (_) {}
  });

  cameraLayer.addEventListener('pointermove', (e) => {
    if (e.pointerId === lookPointerId) {
      if (controlStateMachine.currentState === ControlState.MENU) return;

      e.preventDefault();
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dx === 0 && dy === 0) return;
      enableVirtualPointerLock();

      const SENSITIVITY_X = 2.0;
      const SENSITIVITY_Y = 2.0;
      const movementX = dx * SENSITIVITY_X;
      const movementY = dy * SENSITIVITY_Y;

      if (canvas) {
        const mouseEv = new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          movementX: movementX,
          movementY: movementY
        });
        canvas.dispatchEvent(mouseEv);
      }
    }
  });

  const onEnd = (e) => {
    if (e.pointerId === lookPointerId) {
      try { cameraLayer.releasePointerCapture(e.pointerId); } catch (_) {}
      lookPointerId = null;
    }
  };

  cameraLayer.addEventListener('pointerup', onEnd);
  cameraLayer.addEventListener('pointercancel', onEnd);
  cameraLayer.addEventListener('lostpointercapture', onEnd);
}

/**
 * Robust Multi-Touch Button Binder
 * Ensures each control captures and releases its own pointer ID independently.
 */
function bindTouchButton(elementId, actionName, multiActionMap) {
  const btn = document.getElementById(elementId);
  if (!btn) return;

  let activePointerId = null;

  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (activePointerId !== null) return;

    activePointerId = e.pointerId;
    try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    btn.classList.add('active');

    if (multiActionMap) {
      for (const act of multiActionMap) {
        mobileControls.set(act, elementId, true);
      }
    } else if (actionName) {
      mobileControls.set(actionName, elementId, true);
    }
  };

  const onUp = (e) => {
    if (e.pointerId === activePointerId) {
      e.preventDefault();
      e.stopPropagation();
      try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      activePointerId = null;
      btn.classList.remove('active');

      if (multiActionMap) {
        for (const act of multiActionMap) {
          mobileControls.set(act, elementId, false);
        }
      } else if (actionName) {
        mobileControls.set(actionName, elementId, false);
      }
    }
  };

  btn.addEventListener('pointerdown', onDown);
  btn.addEventListener('pointerup', onUp);
  btn.addEventListener('pointercancel', onUp);
  btn.addEventListener('lostpointercapture', onUp);
}

/**
 * Memory-based Vehicle Proximity Detection
 * Inspects CWorld::Players and CVehiclePool in WASM memory.
 */
function checkNearbyVehicle() {
  try {
    if (!window.wasmMemory) {
      if (typeof HEAP32 !== 'undefined') window.wasmMemory = HEAP32.buffer;
      else if (window.wasmInstance && window.wasmInstance.exports.kg) window.wasmMemory = window.wasmInstance.exports.kg.buffer;
      else if (window.wasmInstance && window.wasmInstance.exports.memory) window.wasmMemory = window.wasmInstance.exports.memory.buffer;
    }
    if (!window.wasmMemory) return false;
    const h32 = new Int32Array(window.wasmMemory);
    const hf32 = new Float32Array(window.wasmMemory);

    const pPlayerPed = h32[0x1b33aa8 >> 2];
    if (!pPlayerPed || pPlayerPed <= 0) return false;

    // Check if player is already inside a vehicle (CPed::m_pMyVehicle at offset 784 = 0x310)
    const inVehicle = h32[(pPlayerPed + 784) >> 2];
    if (inVehicle && inVehicle > 0) return false;

    const px = hf32[(pPlayerPed + 48) >> 2];
    const py = hf32[(pPlayerPed + 52) >> 2];
    const pz = hf32[(pPlayerPed + 56) >> 2];

    if (isNaN(px) || isNaN(py) || (px === 0 && py === 0)) return false;

    const pVehPool = h32[0x1a99f74 >> 2];
    if (pVehPool && pVehPool > 0) {
      let objectsPtr = h32[(pVehPool + 4) >> 2];
      if (!objectsPtr || objectsPtr < 0x1000) objectsPtr = pVehPool;
      const poolSize = 110;
      const stride = 2072;

      for (let i = 0; i < poolSize; i++) {
        const vehPtr = objectsPtr + (i * stride);
        if (vehPtr + 60 >= hf32.byteLength) break;
        const vx = hf32[(vehPtr + 48) >> 2];
        const vy = hf32[(vehPtr + 52) >> 2];
        const vz = hf32[(vehPtr + 56) >> 2];

        if (isNaN(vx) || (vx === 0 && vy === 0)) continue;

        const dx = px - vx;
        const dy = py - vy;
        const dz = pz - vz;
        const distSq = dx * dx + dy * dy + dz * dz;

        // 6.5 meters vehicle carjacking entry radius
        if (distSq < 42.25) {
          return true;
        }
      }
    }
  } catch (_) {}
  return false;
}

let proximityInterval = null;
function startProximityLoop() {
  if (proximityInterval) clearInterval(proximityInterval);
  proximityInterval = setInterval(() => {
    if (controlStateMachine.currentState === ControlState.ON_FOOT) {
      const isNear = checkNearbyVehicle();
      controlStateMachine.setNearCar(isNear);
    }
  }, 150);
}

const activeTouchPointers = new Set();
window.addEventListener('pointerdown', (e) => activeTouchPointers.add(e.pointerId), true);
window.addEventListener('pointerup', (e) => activeTouchPointers.delete(e.pointerId), true);
window.addEventListener('pointercancel', (e) => activeTouchPointers.delete(e.pointerId), true);

/**
 * Developer Debug HUD (?touchdebug=1)
 */
function initTouchDebugHud() {
  const hasTouchDebug = new URLSearchParams(window.location.search).get('touchdebug') === '1';
  if (!hasTouchDebug) return;

  const hud = document.getElementById('touch-debug-hud');
  if (hud) hud.classList.add('visible');

  setInterval(() => {
    const dbgState = document.getElementById('dbg-state');
    const dbgPointers = document.getElementById('dbg-pointers');
    const dbgJoy = document.getElementById('dbg-joy');
    const dbgNear = document.getElementById('dbg-near-car');
    const dbgActions = document.getElementById('dbg-actions');

    if (dbgState) dbgState.textContent = controlStateMachine.currentState;
    if (dbgPointers) dbgPointers.textContent = activeTouchPointers.size;
    if (dbgJoy) dbgJoy.textContent = mobileControls.joyX.toFixed(2) + ', ' + mobileControls.joyY.toFixed(2);
    if (dbgNear) dbgNear.textContent = controlStateMachine.nearCar ? 'YES' : 'NO';
    if (dbgActions) {
      const actArr = Array.from(mobileControls.activeActions);
      dbgActions.textContent = actArr.length > 0 ? actArr.join(', ') : 'none';
    }
  }, 100);
}

/* Authoritative C++ Game State Bitmask Handler */
const TOUCH_STATE_BITS = [
  [1 << 0, 'stateMenu'],
  [1 << 1, 'stateCutscene'],
  [1 << 2, 'stateCar'],
  [1 << 3, 'stateGun'],
  [1 << 4, 'stateCarGun'],
  [1 << 5, 'stateJob'],
  [1 << 6, 'stateVehGun'],
];

function setTouchState(flags) {
  if (flags & (1 << 0)) {
    mainMenuLoaded = true;
    hideEngineStartingSpinner();
  }

  const ds = document.body.dataset;
  for (const [bit, name] of TOUCH_STATE_BITS) {
    ds[name] = (flags & bit) ? '1' : '0';
  }

  controlStateMachine.updateFromFlags(flags);
}

function setTouchDownloadState(on) {
  document.body.dataset.stateDownload = on ? '1' : '0';
}

/**
 * Master Touch Controller Installer
 */
function installTouchControls() {
  if (!isTouchDevice) {
    document.body.dataset.isTouch = '0';
    console.log('[regta3] PC browser mode active — touch controls completely disabled');
    return;
  }

  document.body.dataset.isTouch = '1';

  if (typeof GamepadEmulator === 'function' && !touchEmulator) {
    try {
      touchEmulator = new GamepadEmulator();
      const pad = touchEmulator.AddEmulatedGamepad(null, true);
      if (pad) touchPadIndex = pad.index;
    } catch (err) {
      console.warn('[regta3] GamepadEmulator:', err && err.message ? err.message : err);
    }
  }

  initFloatingJoystick();
  initTouchCameraLayer();

  // Top bar action buttons
  bindTouchButton('btn-touch-home', 'menu');
  bindTouchButton('btn-touch-camera', 'camera');

  // On foot action buttons
  bindTouchButton('btn-attack', 'attack');
  bindTouchButton('btn-jump', 'jump');
  bindTouchButton('btn-sprint', 'sprint');
  bindTouchButton('btn-enter-car', 'enterExit');

  // Driving controls
  bindTouchButton('btn-steer-left', 'steerLeft');
  bindTouchButton('btn-steer-right', 'steerRight');
  bindTouchButton('btn-pedal-gas', 'forward');
  bindTouchButton('btn-pedal-brake', 'reverse');
  bindTouchButton('btn-handbrake', 'handbrake');
  bindTouchButton('btn-horn', 'horn');
  bindTouchButton('btn-exit-car', 'enterExit');

  // Contextual Drive-by controls
  bindTouchButton('btn-driveby-left', null, ['lookLeft', 'attack']);
  bindTouchButton('btn-driveby-right', null, ['lookRight', 'attack']);
  bindTouchButton('btn-driveby-right-alt', null, ['lookRight', 'attack']);

  // Contextual Special Vehicle controls
  bindTouchButton('btn-sub-mission', 'job');

  // Contextual Weapon Cycle Tap Zone (Top right HUD)
  const wpZone = document.getElementById('touch-weapon-cycle');
  if (wpZone) {
    wpZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      mobileControls.tap('weaponNext');
    });
  }

  startProximityLoop();
  initTouchDebugHud();
  controlStateMachine.transitionTo(ControlState.ON_FOOT);

  // Safety cleanup: release all touch controls when window loses focus
  window.addEventListener('blur', () => mobileControls.releaseAll());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) mobileControls.releaseAll();
  });

  // Responsive orientation handler
  function checkOrientation() {
    const warning = document.getElementById('touch-portrait-warning');
    if (warning) {
      const isPortrait = window.innerHeight > window.innerWidth;
      warning.style.display = isPortrait ? 'flex' : 'none';
    }
  }
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
  checkOrientation();

  console.log('[regta3] GTA III 10th Anniversary Mobile Controls initialized successfully');
}


async function resolveAsyncUrl(file) {
  const path = toAssetPath(file);
  if (asyncUrlCache.has(path)) {
    return asyncUrlCache.get(path);
  }
  const rel = path.replace(/^gta3-assets\/local\//i, '');
  const { rel: usedRel, data } = await fetchFirstAvailable(assetCandidates(rel));
  recordStreamedPreload(usedRel);
  const url = URL.createObjectURL(new Blob([data]));
  asyncUrlCache.set(path, url);
  return url;
}

const Module = {
  instantiateWasm: async (imports, callback) => {
    const binary = await (await fetch(`re3.wasm?v=${BUILD_VERSION}`)).arrayBuffer();
    const wasm = await WebAssembly.instantiate(binary, imports);
    window.wasmInstance = wasm.instance;
    window.wasmMemory = wasm.instance.exports.kg || wasm.instance.exports.memory;
    if (window.agti) {
      window.agti(wasm.instance, () => callback(wasm.instance));
    } else {
      callback(wasm.instance);
    }
  },
  noInitialRun: true,
  noExitRuntime: true,
  canvas,
  /* Читается из wasm через regta3_js_language_override (regta3_em_lib.js):
   * -1 — параметра нет, иначе 0..7. При явном ?lang= C++ не форсит русский
   * поверх значения из re3.ini (см. CMenuManager::LoadSettings). */
  regta3LanguageOverride: languageOverride === null ? 0 : languageOverride,
  /* regta3_js_is_touch: dynamically returns 1 during active gameplay on touch devices so C++ sends setTouchState() */
  get regta3IsTouch() {
    return (frameIndex > 0 && isTouchDevice) ? 1 : 0;
  },
  /* regta3_js_touch_state: маска состояния игры → data-state-* на <body>. */
  setTouchState,
  locateFile(path) {
    if (path.endsWith('.wasm')) return `re3.wasm?v=${BUILD_VERSION}`;
    return path;
  },
  preRun: [],
  postRun: [],
  print(...args) {
    const line = args.join(' ');
    console.log(...args);
    updateStatusFromRegta3(line);
    // Track frame-level hang detection
    const enterM = line.match(/\[regta3\] Idle enter frame (\d+)/);
    if (enterM) {
      const fn = parseInt(enterM[1], 10);
      frameIndex = fn;
      frameEnterTime = Date.now();
      frameFinished = false;
      syncCallCount = 0;
      syncCallLog = [];
      if (fn === 1) {/* world init — silent */}
      // Watchdog: if frame doesn't finish within ~5s, show diagnostic (faster feedback for render hangs)
      const capturedFrame = fn;
      setTimeout(() => {
        if (!frameFinished && frameIndex === capturedFrame) {
          showDiagError(
            `Frame ${capturedFrame} зависло (5с+)\n` +
            `sync-вызовов (устар.): ${syncCallCount}\n` +
            `Последние вызовы:\n` + syncCallLog.slice(-15).join('\n')
          );
        }
      }, 5000);
    }
    const finishM = line.match(/\[regta3\] Idle finish frame/);
    if (finishM) {
      frameFinished = true;
    }
  },
  printErr(...args) {
    const msg = args.join(' ');
    if (msg.includes('emscripten_set_main_loop_timing') ||
        msg.includes('GLFW_CURSOR_HIDDEN') ||
        msg.includes('emscripten_sleep') ||
        msg.includes('alGetProcAddress') ||
        msg.includes('bad name in alGetProcAddress')) return;
    console.error(...args);
  },
  setStatus,
  async initFS() {
    const allPaths = await loadPreloadList();
    const paths = allPaths
      .filter((path) => !isBootDeferredAsset(path.replace(/^gta3-assets\/local\//i, '')))
      .sort((a, b) => bootPreloadPriority(a) - bootPreloadPriority(b));
    const deferred = allPaths.length - paths.length;
    console.log(`[regta3] boot preload ${paths.length}/${allPaths.length} files (deferred ${deferred}), concurrency=${PRELOAD_CONCURRENCY}`);
    setStatus(`Assets: 0/${paths.length} (loading...)`);
    setProgress(0, paths.length);

    let done = 0;
    let bytes = 0;
    const t0 = performance.now();
    const total = paths.length;

    const ingestLoaded = (path, rel, data) => {
      writeAssetToFs(Module, path, data);
      try { writeAssetToFs(Module, rel, data); } catch (_) {}
      bytes += data.length || 0;
      const imgMatch = rel.match(/^(models)\/gta3\.img\/([^/]+)$/i);
      if (imgMatch) {
        const aliasRel = `${imgMatch[1]}/${imgMatch[2]}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${aliasRel}`, data);
          writeAssetToFs(Module, aliasRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(aliasRel));
        cacheAssetData(aliasRel, data);
      }
      const cutsMatch = rel.match(/^anim\/(cuts\.(img|dir))$/i);
      if (cutsMatch) {
        const fname = cutsMatch[1].toUpperCase();
        const upperRel = `ANIM/${fname}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${upperRel}`, data);
          writeAssetToFs(Module, upperRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(upperRel));
        cacheAssetData(upperRel, data);
        const lowerRel = `anim/${cutsMatch[1].toLowerCase()}`;
        try {
          writeAssetToFs(Module, `${ASSET_PREFIX}/${lowerRel}`, data);
          writeAssetToFs(Module, lowerRel, data);
        } catch (_) {}
        assetNotFound.delete(normalizeAssetRel(lowerRel));
        cacheAssetData(lowerRel, data);
      }
    };

    await runPool(paths, PRELOAD_CONCURRENCY, async (path) => {
      const rel = path.replace(/^gta3-assets\/local\//i, '');
      const shortRel = rel.length > 48 ? '…' + rel.slice(-47) : rel;
      try {
        const { data } = await fetchFirstAvailable(assetCandidates(rel), (recv, totalBytes) => {
          if (!totalBytes || totalBytes < 1024 * 1024) return;
          const mb = (recv / (1024 * 1024)).toFixed(1);
          const tmb = (totalBytes / (1024 * 1024)).toFixed(1);
          setStatus(`Assets: ${done + 1}/${total} — ${shortRel} (${mb}/${tmb} MB)`);
        });
        ingestLoaded(path, rel, data);
      } catch (err) {
        console.warn('preload skip:', path, err.message || err);
      }
      done += 1;
      setProgress(done, total);
      if (done % 5 === 0 || done === total) {
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        updateLoaderUI(done, total, `Loading Assets (${mb} MB / 72.6 MB)`, shortRel);
      }
      if (done % 250 === 0 || done === total) {
        const mb = (bytes / (1024 * 1024)).toFixed(0);
        if (typeof window.remoteLog === 'function') {
          window.remoteLog('INFO', 'PRELOAD', `Progress: ${done}/${total} files loaded (${mb} MB into VFS)`);
        }
      }
    });

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`[regta3] boot preload done in ${elapsed}s, ${(bytes / (1024 * 1024)).toFixed(1)} MB into VFS`);
    if (typeof window.remoteLog === 'function') {
      window.remoteLog('INFO', 'PRELOAD', `ALL ${total} ASSETS LOADED into VFS in ${elapsed}s! Starting game engine...`);
    }
    updateLoaderUI(total, total, 'Starting Game Engine...', 'Launching Grand Theft Auto III...');
    setTimeout(hideLoaderUI, 800);
    setProgress(0, 0);

    ensureGameDirs(Module);
    try {
      const resetKey = 'regta3dos.defaultsReset';
      const prev = parseInt(localStorage.getItem(resetKey) || '0', 10);
      if (prev < DEFAULTS_RESET_VERSION) {
        /* Drop stale gta3.set so Russian + full default binds apply once. */
        for (const p of [
          `/${ASSET_PREFIX}/userfiles/gta3.set`,
          `/${ASSET_PREFIX}/gta3.set`,
        ]) {
          try {
            if (Module.FS.analyzePath(p).exists) Module.FS.unlink(p);
          } catch (_) {}
        }
        localStorage.setItem(resetKey, String(DEFAULTS_RESET_VERSION));
        console.log('[regta3] reset gta3.set for defaults v' + DEFAULTS_RESET_VERSION);
      }
    } catch (_) {}
    const idbfsOk = await mountUserfilesIdbfs(Module);
    if (idbfsOk) scheduleUserfilesPersist(Module);

    /* Игра читает/пишет userfiles/re3.ini (IDBFS, персистентен между
     * перезагрузками — см. src/core/re3.cpp). Дефолты сеются только когда
     * в IDB ещё нет своего ini, иначе сохранённые настройки затирались бы
     * на каждом буте. */
    try {
      const userIni = `/${ASSET_PREFIX}/userfiles/re3.ini`;
      const hasUserIni = vfsPathExists(Module, userIni) &&
        (Module.FS.stat(userIni).size || 0) > 0;
      if (!hasUserIni) {
        Module.FS.writeFile(userIni, applyTouchControlMethod(applyLanguageOverride(re3Ini)));
        console.log('[regta3] seeded userfiles/re3.ini (' +
          (localStorage.getItem('regta3dos.re3.ini') ? 'localStorage backup' : 'defaults') + ')');
      } else {
        /* Query-параметр и тип устройства сильнее сохранённого ini:
         * правим только Language= / Method=. */
        const saved = Module.FS.readFile(userIni, { encoding: 'utf8' });
        const patched = applyTouchControlMethod(applyLanguageOverride(saved));
        if (patched !== saved) {
          Module.FS.writeFile(userIni, patched);
          console.log('[regta3] re3.ini patched (lang=' + languageOverride +
            ', touch=' + (isTouchDevice ? 1 : 0) + ')');
        }
      }
    } catch (_) {}
    try {
      const setPath = `/${ASSET_PREFIX}/gta3.set`;
      const userSet = `/${ASSET_PREFIX}/userfiles/gta3.set`;
      // Seed defaults only when IDB has no settings yet.
      const hasUserSet = vfsPathExists(Module, userSet) &&
        (Module.FS.stat(userSet).size || 0) > 0;
      if (!hasUserSet && vfsPathExists(Module, setPath)) {
        const setData = Module.FS.readFile(setPath);
        if (setData && setData.length > 0) {
          Module.FS.writeFile(userSet, setData);
        }
      }
      if (vfsPathExists(Module, userSet)) {
        const existing = Module.FS.readFile(userSet);
        if (!existing || existing.length === 0) {
          Module.FS.unlink(userSet);
        }
      }
    } catch (_) {}
    if (idbfsOk && typeof Module.persistUserfiles === 'function') {
      Module.persistUserfiles();
    }

    const critical = [
      'models/frontend.txd',
      'models/menu.txd',
      'models/fonts.txd',
      'models/fonts_r.txd',
      'data/gta3.dat',
      'text/american.gxt',
      'text/russian.gxt',
      'anim/cuts.dir',
      /* gta3_archive.img и cuts.img больше не в буте: модели читаются
       * пофайлово из models/gta3.img/* с асинхронной докачкой, cuts.img
       * префетчится фоном сразу после бута. */
      'models/gta3.dir',
      'models/gta3_archive.dir',
    ];
    const missing = critical.filter((rel) => !vfsPathExists(Module, `/${ASSET_PREFIX}/${rel}`));
    if (missing.length) {
      throw new Error(
        'Critical assets missing in VFS: ' + missing.join(', ') +
        '. Check gta3-assets directory.'
      );
    }
    // CUTS.IMG must be a real archive (~40MB+). A mistaken extract-dir deploy
    // used to leave a tiny file and freeze the intro flyby camera. The archive
    // itself is no longer preloaded — validate only when it's already in VFS.
    try {
      const cutsStat = Module.FS.stat(`/${ASSET_PREFIX}/anim/cuts.img`);
      if (cutsStat && cutsStat.size > 0 && cutsStat.size < 1_000_000) {
        throw new Error(
          `anim/cuts.img is too small (${cutsStat.size} bytes) — archive required.`
        );
      }
      if (cutsStat) console.log(`[regta3] cuts.img ok: ${cutsStat.size} bytes`);
    } catch (err) {
      if (String(err.message || err).includes('too small')) throw err;
      /* not in VFS yet — background prefetch delivers it */
    }
    // Тёплый старт для тяжёлых архивов: качаем cuts.img фоном, пока игрок в меню.
    prefetchAssetAsync('anim/cuts.img');
  },
  onAbort(what) {
    showDiagError('WASM abort: ' + what + '\n[frame: ' + frameIndex + ', sync calls: ' + syncCallCount + ']\n' + syncCallLog.slice(-10).join('\n'));
  },
  prefetchFirstMissionAudio,
  loadAsyncFile,
  getAsyncFileStatus,
  /* DOM-прогресс блокирующей LoadAllRequestedModels (regta3_js_load_progress).
   * current===total скрывает индикатор. Троттлинг ~100мс. */
  reportLoadProgress(current, total) {
    const now = performance.now();
    if (current >= total) {
      if (reportLoadProgressShown) {
        reportLoadProgressShown = false;
        setStatus('');
        setProgress(0, 0);
        setTouchDownloadState(false);
      }
      return;
    }
    if (now - reportLoadProgressLast < 100) return;
    reportLoadProgressLast = now;
    reportLoadProgressShown = true;
    setTouchDownloadState(true);
    setStatus(`Loading models: ${current}/${total}`);
    setProgress(current, total);
  },
  getAsyncUrl(file, onload, onerror) {
    const promise = resolveAsyncUrl(file);
    if (typeof onload === 'function') {
      promise.then(onload).catch((err) => {
        if (typeof onerror === 'function') onerror(err);
      });
      return;
    }
    return promise;
  },
  async mainCalled() {
    Module.FS.mkdirTree('/' + ASSET_PREFIX);
    unlockWebAudio();
    await Module.initFS();
    setStatus('Starting engine...');
    if (typeof Module.callMain === 'function') {
      Module.callMain();
    } else if (typeof Module._async_main === 'function') {
      Module._async_main();
    } else {
      throw new Error('callMain / _async_main not found in WASM');
    }
    if (!worldLoadComplete) {
      setStatus('Menu / loading...');
    }
  },
};

window.Module = Module;

/* Worker-based hang detector — rAF/setInterval die with the main thread. */
(function installHangWatchdog() {
  // Silent watchdog for diagnostics only
})();

async function bootGame() {
  if (bootStarted) return;
  bootStarted = true;
  mountCloudUi(); // параллельно с загрузкой ассетов; pull дождётся промиса
  installGestureUnlock();
  installPointerLockErrorSwallow();
  installTouchControls();

  try {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (typeof type === 'string' && type.indexOf('webgl') !== -1) {
        attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: false });
        /* If GLFW did not specify, prefer MSAA on for sharper edges. */
        if (attrs.antialias === undefined)
          attrs.antialias = true;
      }
      return origGetContext.call(this, type, attrs);
    };

    setStatus('Loading WASM...');
    if (typeof createRe3Module !== 'function') {
      throw new Error('createRe3Module not found');
    }
    await createRe3Module(Module);
    await Module.mainCalled();
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err);
    setStatus('Error: ' + msg);
    showDiagError('Game boot failed: ' + msg);
    bootStarted = false;
  }
}

document.addEventListener('DOMContentLoaded', () => bootGame());
