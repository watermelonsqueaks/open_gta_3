# GTA III to WebAssembly & Mobile Controls: Comprehensive Retrospective & Replication Blueprint

This document contains a complete technical retrospective of everything implemented in the **open_gta_3** project (from raw network capture to production mobile WebAssembly gameplay), followed by a turnkey **Master Prompt & Blueprint** for replicating the exact same architecture for **GTA: Vice City (reVC)**.

---

## Table of Contents
1. [Project Overview & Architectural Architecture](#1-project-overview--architecture)
2. [Chronological Engineering Phases & Problems Solved](#2-chronological-engineering-phases--problems-solved)
   - [Phase 1: Asset Extraction & Virtual File System (VFS) Rebuilding](#phase-1-asset-extraction--virtual-file-system-vfs-rebuilding)
   - [Phase 2: Boot Stabilization, Localization & Cutscene Engine](#phase-2-boot-stabilization-localization--cutscene-engine)
   - [Phase 3: WebAudio Pipeline & Sync XHR Freeze Elimination](#phase-3-webaudio-pipeline--sync-xhr-freeze-elimination)
   - [Phase 4: Standalone Server & GitHub Pages Deployment](#phase-4-standalone-server--github-pages-deployment)
   - [Phase 5: Authentic GTA III 10th Anniversary Mobile Touch System](#phase-5-authentic-gta-iii-10th-anniversary-mobile-touch-system)
   - [Phase 6: 3D Camera Orbit & Virtual Pointer Lock Gestures](#phase-6-3d-camera-orbit--virtual-pointer-lock-gestures)
   - [Phase 7: Advanced Game Engine Bug Fixes & WebAssembly Binary Patching](#phase-7-advanced-game-engine-bug-fixes--webassembly-binary-patching)
3. [Core Technical Implementations & Code Patterns](#3-core-technical-implementations--code-patterns)
   - [A. Smart Quadrant / Angular PWM Joystick](#a-smart-quadrant--angular-pwm-joystick)
   - [B. Multi-Touch Input Layer & Gamepad/Keyboard Bridge](#b-multi-touch-input-layer--gamepadkeyboard-bridge)
   - [C. Game State Machine & C++ Flag Synchronization](#c-game-state-machine--c-flag-synchronization)
   - [D. In-Game Radar Top-Left Relocation via WebAssembly Patching](#d-in-game-radar-top-left-relocation-via-webassembly-patching)
   - [E. Touch-to-Click Menu Emulator](#e-touch-to-click-menu-emulator)
   - [F. Audio Frame-Budget Watchdog & Async Prefetching](#f-audio-frame-budget-watchdog--async-prefetching)
4. [Master Replication Blueprint for GTA: Vice City (reVC)](#4-master-replication-blueprint-for-gta-vice-city-revc)
   - [Vice City Differences & Considerations](#vice-city-differences--considerations)
   - [Turnkey Prompt for AI Assistant](#turnkey-prompt-for-ai-assistant)

---

## 1. Project Overview & Architecture

The objective of this project was to take a WebAssembly build of GTA III (`re3` engine compiled with Emscripten/Clang) from a web portal capture (HAR), make it fully standalone and self-hosted on GitHub Pages, fix all boot freezes and audio hangs, and completely overhaul the mobile experience so it faithfully recreates the original **GTA III: 10th Anniversary Edition (2011)** mobile touchscreen controls.

### Technology Stack
- **Game Engine**: `re3` (reverse-engineered GTA III source compiled to `re3.wasm` with WebGL 1/2, GLFW, OpenAL, and Emscripten).
- **Virtual File System**: Emscripten `MEMFS` combined with IndexedDB (`IDBFS`) for save states (`userfiles/`).
- **Input Bridge**: Dual-layer input translation:
  - Custom `MobileControlState` translating touch events into synthetic `KeyboardEvent`s and `MouseEvent`s.
  - Virtual `GamepadEmulator` exposing a W3C Standard Gamepad to the engine (`touchEmulator.MoveAxis`, `PressButton`).
- **UI & Touch Overlay**: Hardware-accelerated, resolution-independent Vanilla CSS (`touch.css`) and semantic HTML5 (`index.html`) using pure SVG vector glyphs.
- **Local Dev Server**: Python HTTP server (`server.py`) supporting HTTP 206 Partial Content (Range requests) and correct WebAssembly MIME types.

```
+-----------------------------------------------------------------------------------+
|                                 HTML5 Browser / Viewport                          |
|                                                                                   |
|  +-------------------------+  +------------------------------------------------+  |
|  |     Touch Overlay       |  |                 WebGL Canvas                   |  |
|  | (SVG Icons & CSS Grid)  |  |   +------------------------------------------+ |  |
|  |                         |  |   |           re3.wasm Engine Core           | |  |
|  | - Floating Joystick     |  |   | - CGame::Process() frame loop            | |  |
|  | - Camera Orbit Layer    |  |   | - CRadar (Top-Left binary patch)         | |  |
|  | - On-Foot Action Cluster|  |   | - CWorld::Players (Memory read)          | |  |
|  | - Driving Pedals/Steer  |  |   | - Frontend Menu Manager                  | |  |
|  +------------+------------+  |   +--------------------+---------------------+ |  |
|               |               +------------------------|-----------------------+  |
|               v                                        v                          |
|  +-------------------------+              +------------------------+              |
|  |   MobileControlState    |              |   Emscripten VFS/MEMFS |              |
|  | - Proportional PWM Walk |              | - gta3-assets/local/   |              |
|  | - Virtual Gamepad Axes  |              | - cuts.img archive     |              |
|  | - Synthetic Mouse/Keys  |              | - userfiles/ (IDBFS)   |              |
|  +-------------------------+              +------------------------+              |
+-----------------------------------------------------------------------------------+
```

---

## 2. Chronological Engineering Phases & Problems Solved

### Phase 1: Asset Extraction & Virtual File System (VFS) Rebuilding
- **Input Data**: Raw HTTP Archive captures (`dos.zone.har`, `dos.zone_2.har`).
- **Extraction**: Wrote Python scripts to parse JSON entries, decode Base64 response bodies, and reconstruct the GTA directory hierarchy:
  - `re3.wasm`: The compiled WebAssembly binary (approx 3.48 MB).
  - `index.js`: The Emscripten runtime bootstrap (approx 280 KB).
  - `gta3-assets/local/`: Textures (`.txd`), colls, models (`.dff`, `gta3.img`), audio (`sfx.raw/`, radio beds), and cutscenes (`anim/cuts.img`).
- **File Asset Routing**: Separated assets into:
  - `preload_files.list`: Critical initial files required to initialize the engine (frontend TXDs, fonts, GTA scripts).
  - `stream_files.list`: Heavy audio/streaming models downloaded on-demand via async XHR/fetch.

### Phase 2: Boot Stabilization, Localization & Cutscene Engine
- **English Language Forcing**:
  - The initial port defaulted to Russian (`Language=6`).
  - Added URL parameter detection `?lang=en` and forced `Language=0` in `userfiles/re3.ini` and `gta3.set`.
- **Intro Flyby Camera & Cutscene Freeze**:
  - The game hung indefinitely right after the opening loading screen during the Liberty City bridge cutscene.
  - **Root Cause**: `anim/cuts.img` was extracted as a directory instead of a monolithic disk image, leaving a stub file of only a few hundred bytes. The engine failed when seeking cutscene animations.
  - **Fix**: Rebuilt the authentic monolithic `cuts.img` (~40MB archive) and validated archive size in `game.js` before booting.

### Phase 3: WebAudio Pipeline & Sync XHR Freeze Elimination
- **Root Cause of Gameplay Hangs**:
  - Whenever Claude walked near a pedestrian or a car engine started, `re3` executed synchronous `XMLHttpRequest`s to fetch sound effects from the web server.
  - If network roundtrip exceeded a frame interval, the browser main thread blocked, cascading into a fatal watchdog freeze.
- **Fix**:
  - Implemented an **Adaptive Frame-Budget Watchdog**:
    - `ENSURE_BUDGET_PER_FRAME_MS = 12`: Soft ceiling per frame for sync IO.
    - `ENSURE_HARD_CAP_PER_FRAME_MS = 28`: Absolute hard ceiling. Once exceeded, further sync loads were deferred to background frames.
  - Pre-warmed audio assets:
    - `HOT_SFX_IDS`: Prefetched footsteps, weapon fires, collisions, and car horns into MEMFS immediately after menu load.
    - `RADIO_BED_NAMES`: Streamed 7-27MB radio loop WAVs asynchronously.
    - `FIRST_MISSION_AUDIO`: Prefetched "Luigi's Girls" mission dialogues (`l1_lg.mp3`, `lib_a.wav`, etc.) while player was still in the intro.
  - WebAudio unlocking: AudioContext was created in suspended state due to browser autoplay policies; installed user-gesture kickers (`touchstart`, `mousedown`, `keydown`).

### Phase 4: Standalone Server & GitHub Pages Deployment
- Developed `server.py`:
  - Python HTTP server with custom `Range` request handler for `.wasm` and `.wav` streaming.
  - Proper MIME types: `application/wasm`, `audio/wav`, `audio/mpeg`.
- Created GitHub repository: [`Nikhil-Verma22/open_gta_3`](https://github.com/Nikhil-Verma22/open_gta_3).
- Added `.nojekyll` to prevent GitHub Pages from ignoring directories with underscores or hidden asset structures.
- Configured dynamic `ASSET_BASE` resolution for path compatibility regardless of hosting domain or subfolder.

### Phase 5: Authentic GTA III 10th Anniversary Mobile Touch System
- **Design Paradigm**: Emulated the original 2011 iOS/Android release by Rockstar Games (War Drum Studios) rather than generic emulators.
- **Layout Architecture**:
  - **Top Bar**:
    - Home / Pause Menu button (`#btn-touch-home`): Directly beneath the minimap at top-left.
    - Camera View Toggle (`#btn-touch-camera`): Beside the weapon HUD at top-right.
    - Quick Weapon Cycle Zone (`#touch-weapon-cycle`): Invisible tap target directly over the active weapon HUD.
  - **On-Foot Mode (Right Cluster)**:
    - Enter/Exit Vehicle (Car Door): Top of the vertical column.
    - Attack/Fire (Clenched Fist): Middle of the column.
    - Jump (Jumping Figure): Bottom-right of the screen.
    - Sprint (Running Figure): Horizontally to the left of Jump.
  - **Driving Mode (Pedals & Steering)**:
    - Left side: Left/Right steering arrows (`<` and `>`), Left/Right drive-by buttons.
    - Right side: Gas pedal (`#btn-pedal-gas`), Brake pedal (`#btn-pedal-brake`), Handbrake (tire skid mark icon), Horn/Siren, and Car Exit door.
  - **Orientation Lock**:
    - Enforced landscape orientation; displayed a clean blur overlay (`#touch-portrait-warning`) if rotated to portrait.

### Phase 6: 3D Camera Orbit & Virtual Pointer Lock Gestures
- Implemented `#touch-camera-layer`:
  - Invisible, full-screen touch listener active only in the right/center regions of the screen.
  - Tracks swipe velocity `(dx, dy)` and dispatches synthetic `mousemove` events to the WebGL canvas with configurable sensitivity multipliers (`SENSITIVITY_X = 2.0`, `SENSITIVITY_Y = 2.0`).
  - Enabled virtual pointer lock emulation to allow 360-degree continuous camera rotation without losing tracking when fingers cross canvas boundaries.

### Phase 7: Advanced Game Engine Bug Fixes & WebAssembly Binary Patching
From real-device Android testing, 7 critical bugs were identified and fixed:

1. **The Joystick Backward Jump Bug**:
   - *Problem*: Pulling the joystick down/backward caused Claude to continuously jump while walking.
   - *Root Cause*: In `game.js`, `reverse` had `gpBtn: TOUCH_BTN.X`. In GTA III gamepad controls on foot, Button X is Jump!
   - *Solution*: Removed `gpBtn` from on-foot movement. Created separate `pedalGas` (Button A) and `pedalBrake` (Button X) for vehicles only.

2. **Smart Quadrant / Angular PWM Walking**:
   - *Problem*: Digital keyboard mapping (W/A/S/D) forced 8-way rigid movement with 45-degree snapping.
   - *Solution*: Built a duty-cycle PWM algorithm (10 time slices across 120ms cycle). If the joystick is tilted 60% forward and 40% right, the forward key is held for 60% of the cycle and the right key for 40%, producing smooth analog movement.

3. **Sprint Button Single-Tap Toggle**:
   - *Problem*: Holding sprint while dragging the camera or jumping was impossible with standard fingers.
   - *Solution*: Converted `#btn-sprint` into a stateful toggle with a gold/yellow glowing border indicator. Tapping once locks sprint ON; tapping again turns it OFF.

4. **Permanent Enter Car Button**:
   - *Problem*: `#btn-enter-car` was hidden behind an unreliable memory proximity scan (`checkNearbyVehicle()`), making it impossible to get into cars.
   - *Solution*: Set `#btn-enter-car` to be permanently visible in on-foot mode, exactly matching the 10th Anniversary mobile layout.

5. **Relocating In-Game Radar to Top-Left in WebAssembly**:
   - *Problem*: The PC `re3` radar rendered at screen bottom-left, directly under the movement joystick.
   - *Root Cause*: In `CRadar::DrawMap` (`0x7562f`) and `CRadar::TransformRadarPointToScreenSpace` (`0x2cab62`), radar Y position was calculated as `SCREEN_HEIGHT - SCREEN_SCALE_Y(123.0f)` ($Y = 357\text{px}$).
   - *Solution*: Patched both float constants in `re3.wasm` from `123.0f`/`129.0f` to `400.0f` (`00 00 c8 43`), repositioning the radar to $Y = 80\text{px}$ (top-left). Also injected an automatic runtime byte patcher in `Module.instantiateWasm`.

6. **Menu Touch Clicks on Mobile**:
   - *Problem*: Tapping menu options moved the mouse cursor to the button but never clicked it.
   - *Solution*: Created `initMenuTouchClickSupport()`, which detects touch taps (< 18px drift, < 450ms) and dispatches a sequence: `mousemove` $\rightarrow$ `mousedown` (held 60ms) $\rightarrow$ `mouseup` $\rightarrow$ `click` $\rightarrow$ `Enter` keypress (`keyCode: 13`).

7. **Save State / Skip Cutscene Fix**:
   - *Problem*: Clicking "Start Game" was auto-selecting "Resume" due to old save files in IndexedDB (`regta3dos.userfiles.idbfs`), bypassing the opening intro.
   - *Solution*: Added support for URL parameters `?newgame=1` and `?clearsaves=1` to cleanly purge old save slots from VFS before engine boot.

---

## 3. Core Technical Implementations & Code Patterns

### A. Smart Quadrant / Angular PWM Joystick
```javascript
/**
 * Smart Quadrant / Angular PWM Joystick in MobileControlState:
 * Measures joystick angle & quadrant percentage and pulses the quadrant keys proportionally
 * (e.g. 60% forward, 40% right duty cycle) for smooth analog-like walking.
 */
setJoystick(nx, ny) {
  this.joyX = nx;
  this.joyY = ny;

  // Pass true 360-degree analog values to the virtual gamepad
  if (touchEmulator && touchPadIndex >= 0) {
    try {
      touchEmulator.MoveAxis(touchPadIndex, 0, nx);
      touchEmulator.MoveAxis(touchPadIndex, 1, ny);
    } catch (_) {}
  }

  const mag = Math.hypot(nx, ny);
  const deadzone = 0.18;
  if (mag < deadzone) {
    this.resetJoystick();
    return;
  }

  // Determine quadrant actions
  const yAction = ny < 0 ? 'forward' : 'reverse';
  const xAction = nx < 0 ? 'steerLeft' : 'steerRight';
  const oppY = ny < 0 ? 'reverse' : 'forward';
  const oppX = nx < 0 ? 'steerRight' : 'steerLeft';

  // Instantly release opposite axes
  this.set(oppY, 'joy_pwm', false);
  this.set(oppX, 'joy_pwm', false);

  const absX = Math.abs(nx);
  const absY = Math.abs(ny);
  const total = absX + absY;
  const pctY = total > 0 ? (absY / total) : 0;
  const pctX = total > 0 ? (absX / total) : 0;

  this.joyTarget = { yAction, xAction, pctY, pctX };

  if (!this.joyPwmTimer) {
    this.joyTick = 0;
    this._pwmStep();
    this.joyPwmTimer = setInterval(() => this._pwmStep(), 12);
  } else {
    this._pwmStep();
  }
}

_pwmStep() {
  const t = this.joyTarget;
  if (!t || (!t.yAction && !t.xAction)) return;

  // 10-step duty cycle (12ms * 10 = 120ms total cycle)
  const step = (this.joyTick++) % 10;
  const ySteps = Math.round(t.pctY * 10);
  const xSteps = Math.round(t.pctX * 10);

  const isYDown = step < ySteps;
  const isXDown = step >= (10 - xSteps);

  if (t.yAction) this.set(t.yAction, 'joy_pwm', isYDown);
  if (t.xAction) this.set(t.xAction, 'joy_pwm', isXDown);
}

resetJoystick() {
  if (this.joyPwmTimer) {
    clearInterval(this.joyPwmTimer);
    this.joyPwmTimer = null;
  }
  this.joyTick = 0;
  this.joyTarget = { yAction: null, xAction: null, pctY: 0, pctX: 0 };
  this.joyX = 0;
  this.joyY = 0;

  if (touchEmulator && touchPadIndex >= 0) {
    try {
      touchEmulator.MoveAxis(touchPadIndex, 0, 0);
      touchEmulator.MoveAxis(touchPadIndex, 1, 0);
    } catch (_) {}
  }

  this.set('forward', 'joy_pwm', false);
  this.set('reverse', 'joy_pwm', false);
  this.set('steerLeft', 'joy_pwm', false);
  this.set('steerRight', 'joy_pwm', false);
}
```

### B. Multi-Touch Input Layer & Gamepad/Keyboard Bridge
```javascript
// Clean separation between on-foot movement (keys only) and vehicle pedals (keys + gamepad buttons)
this.keyDefinitions = {
  forward: {
    keys: [{ key: 'w', code: 'KeyW', keyCode: 87 }, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }]
    // gpBtn removed to prevent jumping/running conflicts on foot
  },
  reverse: {
    keys: [{ key: 's', code: 'KeyS', keyCode: 83 }, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }]
    // gpBtn: TOUCH_BTN.X removed! Prevents Claude from jumping when walking backwards
  },
  pedalGas: {
    keys: [{ key: 'w', code: 'KeyW', keyCode: 87 }, { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 }],
    gpBtn: TOUCH_BTN.A
  },
  pedalBrake: {
    keys: [{ key: 's', code: 'KeyS', keyCode: 83 }, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 }],
    gpBtn: TOUCH_BTN.X
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
  }
};
```

### C. Game State Machine & C++ Flag Synchronization
```javascript
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
    if (isCarGun) nextState = ControlState.DRIVE_BY;
    else if (isVehGun || isJob) nextState = ControlState.SPECIAL_VEHICLE;
    else nextState = ControlState.DRIVING;
  } else {
    nextState = ControlState.ON_FOOT;
  }

  controlStateMachine.transitionTo(nextState);
}
```

### D. In-Game Radar Top-Left Relocation via WebAssembly Patching
```javascript
/**
 * Automatically repoints the radar Y offset in WebAssembly memory
 * From 123.0f (bottom-left) to 400.0f (top-left).
 */
function patchRadarTopLeft(wasmBytes) {
  const f_129 = [0x00, 0x00, 0x01, 0x43]; // 129.0f
  const f_123 = [0x00, 0x00, 0xf6, 0x42]; // 123.0f
  const f_400 = [0x00, 0x00, 0xc8, 0x43]; // 400.0f (places center at Y = 80px)

  function replacePattern(target) {
    let count = 0;
    for (let i = 0; i < wasmBytes.length - 4; i++) {
      if (wasmBytes[i] === target[0] && wasmBytes[i+1] === target[1] &&
          wasmBytes[i+2] === target[2] && wasmBytes[i+3] === target[3]) {
        wasmBytes[i] = f_400[0];
        wasmBytes[i+1] = f_400[1];
        wasmBytes[i+2] = f_400[2];
        wasmBytes[i+3] = f_400[3];
        count++;
      }
    }
    return count;
  }
  replacePattern(f_129);
  replacePattern(f_123);
}

// In Module.instantiateWasm:
const Module = {
  instantiateWasm: async (imports, callback) => {
    const raw = await (await fetch(`re3.wasm?v=${BUILD_VERSION}`)).arrayBuffer();
    const binary = new Uint8Array(raw);
    patchRadarTopLeft(binary);
    const wasm = await WebAssembly.instantiate(binary, imports);
    window.wasmInstance = wasm.instance;
    callback(wasm.instance);
  }
};
```

### E. Touch-to-Click Menu Emulator
```javascript
function initMenuTouchClickSupport() {
  const canvasEl = document.getElementById('canvas');
  if (!canvasEl) return;
  let menuTouchStart = null;

  window.addEventListener('pointerdown', (e) => {
    const isMenu = (controlStateMachine.currentState === ControlState.MENU) || (document.body.dataset.stateMenu === '1');
    if (!isMenu) return;
    menuTouchStart = { x: e.clientX, y: e.clientY, time: performance.now(), pointerId: e.pointerId };
  }, true);

  window.addEventListener('pointerup', (e) => {
    if (!menuTouchStart || e.pointerId !== menuTouchStart.pointerId) return;
    const start = menuTouchStart;
    menuTouchStart = null;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - start.time;

    // Detect intentional tap (< 18px drift, < 450ms hold)
    if (dist < 18 && dt < 450) {
      const { clientX, clientY } = e;

      // 1. Move cursor to position to highlight menu entry
      canvasEl.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true, cancelable: true }));

      // 2. Dispatch mousedown (button 0)
      canvasEl.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX, clientY, bubbles: true, cancelable: true }));

      // 3. Hold for 60ms and release mouseup + click + Enter key
      setTimeout(() => {
        canvasEl.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 0, clientX, clientY, bubbles: true, cancelable: true }));
        canvasEl.dispatchEvent(new MouseEvent('click', { button: 0, clientX, clientY, bubbles: true, cancelable: true }));

        const kDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        const kUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        window.dispatchEvent(kDown);
        canvasEl.dispatchEvent(kDown);
        setTimeout(() => {
          window.dispatchEvent(kUp);
          canvasEl.dispatchEvent(kUp);
        }, 50);
      }, 60);
    }
  }, true);
}
```

---

## 4. Master Replication Blueprint for GTA: Vice City (reVC)

### Vice City Differences & Considerations
When applying this architecture to **GTA: Vice City (reVC)**, keep the following differences in mind:

| Feature / System | GTA III (`re3`) | GTA: Vice City (`reVC`) | Implementation Notes for Vice City |
| :--- | :--- | :--- | :--- |
| **Engine Binary** | `re3.wasm` | `reVC.wasm` | Binary name and symbols differ slightly. |
| **User Settings** | `re3.ini` / `gta3.set` | `reVC.ini` / `gta_vc.set` | Update config paths and defaults reset version. |
| **Asset Directory** | `gta3-assets/local/` | `gtavc-assets/local/` | Update asset prefix in loader scripts. |
| **Cutscene Archive** | `anim/cuts.img` | `anim/cuts.img` | Must also be a real monolithic archive file. |
| **Vehicles** | Cars and Boats | Cars, Boats, **Motorcycles & Helicopters** | Need leaning controls for bikes (Shift/Ctrl or Analog Stick Pitch) and rudder controls for helicopters. |
| **Drive-By System** | Mac/Uzi from car | 360-degree shooting on bikes, left/right in cars | Drive-by cluster should activate forward firing when riding motorbikes. |
| **Sprint Mechanic** | Holding Shift sprints (Claude gets tired) | Tommy Vercetti has stamina upgrades | Sprint button toggle works identically. |
| **Visual Aesthetics** | Dark industrial Liberty City gray/blue | 1980s Neon Pink (`#ff007f`) & Cyan (`#00f0ff`) | Change HUD button accents and borders to Vice City neon palette. |
| **Radar Placement** | Bottom-left on PC $\rightarrow$ Top-left on Mobile | Bottom-left on PC $\rightarrow$ Top-left on Mobile | Search `reVC.wasm` for radar Y coordinate calculation to patch top-left. |

---

### Turnkey Prompt for AI Assistant

Copy and paste the prompt below into a new session with an AI coding agent to port **GTA: Vice City** using this exact production architecture:

```markdown
# TASK: Port GTA: Vice City (reVC WebAssembly) with Authentic 10th Anniversary Mobile Controls

You are tasked with porting, stabilizing, and building the mobile touchscreen control system for a WebAssembly build of GTA: Vice City (reVC).

Follow the proven architecture established in the open_gta_3 project:

==================================================
1. CORE ARCHITECTURAL PRINCIPLES
==================================================
- DO NOT patch the core WASM engine unless modifying UI positions (e.g., radar).
- Translate mobile touch gestures into a dual input bridge:
  1. Synthetic KeyboardEvents and MouseEvents dispatched to the canvas.
  2. W3C Standard GamepadEmulator feeding analog axes and buttons to GLFW.
- Never use generic modern mobile HUDs. Strictly recreate the authentic GTA Vice City 10th Anniversary mobile controls layout (pink/cyan neon palette, authentic icons, correct ergonomics).
- Never block the browser main thread with synchronous XHR audio requests.

==================================================
2. VFS & ASSET PIPELINE
==================================================
- Extract reVC.wasm and assets from the network capture/archive into `gtavc-assets/local/`.
- Maintain two asset loading tiers:
  - `preload_files.list`: Critical boot files (frontend TXDs, fonts, american.gxt, data/*.dat).
  - Background async streaming for radio stations and non-critical SFX.
- Ensure `anim/cuts.img` is a valid monolithic archive (not an extracted directory) to avoid cutscene camera freezes.
- Setup audio frame budgets: soft cap 12ms, hard cap 28ms to prevent sync XHR audio storms from freezing gameplay.

==================================================
3. MOBILE CONTROLS ARCHITECTURE
==================================================
- Landscape mode only (show orientation warning overlay when in portrait).
- Separation of concerns:
  - `touch.css`: Hardware-accelerated, resolution-independent CSS with pure SVG icons.
  - `game.js`: Multi-touch `MobileControlState` with reference-counted action sources.
  - `ControlStateMachine`: Sync with C++ game state bitmask flags (ON_FOOT, DRIVING, BIKE, HELI, MENU).
- Layout:
  - Left Thumb: Dynamic floating joystick with smart quadrant PWM duty cycling:
    - Measure angle and component percentages (|nx| / (|nx| + |ny|)).
    - Cycle keypresses across a 120ms duty cycle window (e.g., 60% forward, 40% right) to eliminate rigid 8-way digital snapping.
    - Feed analog coordinates to touchEmulator.MoveAxis(0, nx) and (1, ny).
  - Right Thumb: Swipe-to-rotate camera layer with virtual pointer lock emulation.
  - On-Foot Cluster (Right):
    - Enter Vehicle (Car Door) permanently visible at top.
    - Attack (Fist) in middle.
    - Jump (Jumping figure) at bottom-right.
    - Sprint (Running figure) beside Jump. Must be a single-tap TOGGLE with visual neon highlight.
  - Driving Cluster:
    - Left side: Steer Left (<), Steer Right (>), Drive-By Left/Right.
    - Right side: Gas Pedal, Brake/Reverse Pedal, Handbrake, Horn, Exit Vehicle.
  - Top Bar:
    - Home / Pause Menu button situated directly under the minimap at top-left.
    - Camera View toggle situated beside the weapon HUD at top-right.
    - Weapon cycle tap target over the active weapon HUD.

==================================================
4. CRITICAL BUG PREVENTIONS (LEARNED FROM GTA 3)
==================================================
1. Joystick Backward Jump Bug:
   - Ensure the on-foot `reverse` action has NO gamepad button mapped (especially not Button X / 2). Gamepad Button X is Jump on foot! Keep Button X strictly on `pedalBrake` in vehicle mode.
2. Menu Touch Clicks:
   - Implement `initMenuTouchClickSupport()` to detect clean taps in menu state and dispatch `mousemove` + `mousedown` (held 60ms) + `mouseup` + `click` + `Enter` keypress (`keyCode: 13`).
3. Top-Left Radar Placement:
   - In PC reVC, the radar is drawn at screen bottom-left (`SCREEN_HEIGHT - SCREEN_SCALE_Y(...)`).
   - Patch the radar Y offset in `reVC.wasm` from bottom-left to top-left (~400.0f) so it sits cleanly in the top-left corner above the Home button.
4. Clean Save States:
   - Add `?newgame=1` query parameter support to wipe stale IndexedDB save files (`gta_vc*.b`) to allow fresh intro cutscene playthroughs.

==================================================
5. TESTING & VERIFICATION
==================================================
- Always test with mobile viewport emulation (e.g. 844 x 390 landscape).
- Verify:
  1. Radar renders at top-left.
  2. Pulling joystick down moves character backward without jumping.
  3. Sprint button toggles on/off with active visual glow.
  4. Enter car button is always visible on foot.
  5. Menu items can be tapped directly.
```
