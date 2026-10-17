# OrbitNet Project Map

## 📋 Overview
Interactive "useless" website with a red button that does unexpected things when pressed. Fully front-end, no backend/database. ~674 lines of code.

---

## 🏗️ Project Structure

```
orbitnet/
├── .git/                          # Git repository
├── .github/
│   └── workflows/
│       └── deploy.yml             # CI/CD pipeline
├── docker-compose.yml             # Nginx container + Caddy network
├── site/                          # Main website folder
│   ├── index.html                 # HTML structure (79 lines)
│   ├── css/
│   │   └── style.css              # All styling (126 lines)
│   └── js/                        # JavaScript modules
│       ├── sound.js               # Web Audio API synth (74 lines)
│       ├── ui.js                  # UI utils & state (82 lines)
│       ├── signup.js              # Fake 3-step registration (142 lines)
│       ├── jokes.js               # Content & scenarios (102 lines)
│       └── main.js                # Main app engine (56 lines)
└── PROJECT_MAP.md                 # This file
```

---

## 📄 File Breakdown

### **index.html** (79 lines)
**Purpose:** HTML structure and DOM elements  
**Key Elements:**
- `#btn` — Main circular red button (220x220px)
- `#msg` — Dynamic message area (aria-live)
- `#mute` — Sound toggle button (top-right)
- `#overlay` — Fake progress bar overlay
- `#cookie` — Fake cookie banner
- `#signup` — Hidden registration modal
- `#count` — Click counter (bottom)
- `#toast` — Notification area (top)

**Script Load Order:**
1. sound.js
2. ui.js
3. signup.js
4. jokes.js
5. main.js

---

### **style.css** (126 lines)
**Purpose:** Complete visual styling  
**Key Features:**
- **Theme System:** CSS variables (`:root` dark, `body.light` for light mode)
- **Main Button `#btn`:**
  - Red radial gradient
  - Box-shadow for 3D effect
  - States: `.small` (140px), `.sulk` (disabled gray), `.runner` (moving)
  - translateY(8px) press animation
- **Animations:** `shake` (0.5s body shake)
- **Modal `.card`:** 420px max-width, semi-transparent overlay
- **Overlay `#overlay`:** Fake progress bar (neon green on black)
- **Toast `#toast`:** Slides down from top
- **Cookie Banner `#cookie`:** White banner at bottom
- **Accessibility:** `@media (prefers-reduced-motion)` support

---

### **sound.js** (74 lines)
**Purpose:** Generate sound effects via Web Audio API (no audio files)  
**Sounds Exported:**
| Function | Frequency | Use |
|----------|-----------|-----|
| `click(n)` | 260-520Hz | Button press (increases with each click) |
| `tick()` | 1200Hz | Progress bar tick |
| `ding()` | 880+1320Hz | Achievement sound |
| `win()` | 523,659,784,1047Hz | Victory chord |
| `sad()` | 392,370,349,311Hz | Sad descending |
| `error()` | 160+120Hz | Error buzz |
| `boom()` | 90→30Hz | Explosion |
| `whoosh()` | 300→900Hz | Button escape sweep |
| `whistle()` | 800→1250Hz | Whistle |

**Key Utilities:**
- `ac()` — Lazy AudioContext initialization
- `tone(freq, dur, type)` — Sine/square/triangle/sawtooth
- `noise(dur)` — White noise with filter
- Mute state persisted in localStorage
- Graceful fallback if AudioContext unavailable

---

### **ui.js** (82 lines)
**Purpose:** UI utilities, state management, and storage wrapper  
**Exports:**

**`DPB.state`** — Current session state:
```javascript
{
  clicks: 0,    // Clicks this session
  total: 0,     // Total clicks from localStorage
  name: ''      // User nickname from signup
}
```

**`DPB.store`** — localStorage wrapper with error handling:
- `get(key)` — Get value with try/catch
- `set(key, value)` — Save value with try/catch

**`DPB.ui`** — UI functions:
- `btn` — Reference to #btn element
- `say(text)` — Change #msg content
- `toast(text)` — Show 3.2s notification with 🏆
- `shake(element)` — Trigger shake animation
- `sleep(ms)` — Promise-based delay
- `progress(text, ms, plain, endAt)` — Show fake progress overlay
- `hideOverlay()` — Hide overlay
- `showCookie()` / `hideCookie()` — Toggle cookie banner
- `startRunaway(callback)` — Button starts moving on hover
- `isRunaway()` — Check if button is escaping

**Runaway Button Logic:**
- On pointer enter: button moves to random position
- After 5 escape attempts: button "caught", callback fires

---

### **signup.js** (142 lines)
**Purpose:** Fake 3-step registration modal (data only stored locally)  

**Step 1: Password Validation**
- Nickname (max 20 chars)
- Password with 5 absurd rules:
  - ✗ "At least 8 characters" AND ✗ "At most 3 characters" (contradiction!)
  - ✓ "Contains a number"
  - ✓ "Contains the sound a cat makes" (meow/miau/nya/mrrp)
  - ✓ "Is not 'password'"
- After 3 failed attempts: auto-accept "hunter2"

**Step 2: CAPTCHA (Joke)**
- Checkbox: "I'm not a button"
- 3 attempts: 62% button → 41% button → "Verified (probably)"

**Step 3: Terms of Service**
- 36 absurd clauses (clauses repeated 3x for padding)
- Must scroll to bottom to enable "I accept" button
- "Decline" button is disabled (joke)

**Data Saved:**
- Only `nickname` saved to `localStorage['dpb_name']`
- Nothing sent anywhere (fully fake)

---

### **jokes.js** (102 lines)
**Purpose:** Content scenarios and event sequences  

**`steps[]` — 13 Sequential Main Events:**
| # | Event | Description |
|---|-------|-------------|
| 0 | Initial warning | "Um... it literally says DON'T press." |
| 1 | Achievement | First Disobedience unlock |
| 2 | Button grows | "PLEASE DON'T PRESS" |
| 3 | Button shrinks | `.small` class applied |
| 4 | Fake deletion | Progress bar: "Deleting System32/photos/internet" |
| 5 | Registration | Opens `DPB.signup.open()` modal (promise-based) |
| 6 | Button sulks | `.sulk` state + sad sound effect |
| 7 | Error message | "ERROR 418: I'm a teapot" + shake + whistle |
| 8 | Cookie banner | Shows fake cookie consent |
| 9 | Button escapes | Activates `.runner` mode (runaway) |
| 10 | Fake update | "Updating... 99%" (stuck forever) |
| 11 | Theme toggle | Switches to light mode |
| 12 | Stats display | Shows total click count |
| 13 | Final message | "Fine, press as much as you like" |

**`late[]` — Post-step-13 Random Messages (10 entries):**
- One-liners with humor
- Supports `{name}` placeholder for personalization

**`lateEvents[]` — Extra Random Events (35% chance each press after step 13):**
- `shake()` + boom sound
- Toast with click statistics
- Toggle light mode

---

### **main.js** (56 lines)
**Purpose:** Main application engine and click handler  

**Initialization:**
1. Load `dpb_name` and `dpb_total` from localStorage
2. Display welcome message if returning user
3. Set up mute button with icon toggle (🔊/🔇)
4. Set up cookie banner (both buttons look identical as joke)

**Main Click Loop:**
```javascript
btn.click → {
  st.clicks++, st.total++
  Save to localStorage
  
  if (isRunaway) return;  // Just count, no new scenario
  
  locked = true
  if (step < jokes.length) {
    await jokes.steps[step++]()
  } else {
    say(pick(late))
    if (Math.random() < 0.35) pick(lateEvents)()
  }
  locked = false
}
```

**Lock Mechanism:**
- `locked = true` prevents multiple simultaneous clicks
- Async operations (signup, delays) respect this lock

**Key Features:**
- Mute state persisted in localStorage
- Click counts persisted and accumulated
- Prevents double-clicking during sequences

---

### **docker-compose.yml** (13 lines)
**Purpose:** Deployment configuration  

**Service: orbitnet-site**
- Image: `nginx:alpine` (lightweight web server)
- Container name: `orbitnet-site`
- Restart: `unless-stopped` (auto-restart on crash)
- Volume: `./site` mounted read-only to nginx html
- Port: `127.0.0.1:8081:80` (localhost only)
- Network: `caddy_net` (external Caddy proxy)

**Deploy:** `docker-compose up -d` → site accessible at `http://127.0.0.1:8081`

---

## 🔄 Data Flow

```
User clicks button
    ↓
main.js: Increment st.clicks, st.total
    ↓
Save to localStorage ('dpb_total')
    ↓
Is button escaping? → Return (no new scenario)
    ↓
Set locked = true (prevent multi-click)
    ↓
Execute jokes.steps[step]() [async]
    ↓
step < 13?
├─ YES → step++, next scenario
└─ NO → Random message + 35% chance extra event
    ↓
Set locked = false (allow next click)
```

### Example Scenario Flow (Step 5: Registration)
```
jokes.steps[5]()
    ↓
signup.open() [returns promise]
    ↓
Modal visible, user fills form
    ↓
"I accept" clicked
    ↓
DPB.state.name = nickname saved
    ↓
Promise resolves
    ↓
main.js continues to step 6
```

### Example Scenario Flow (Step 9: Runaway)
```
jokes.steps[9]()
    ↓
startRunaway(callback)
    ↓
Button gets .runner class
    ↓
User hovers → button moves 5 times
    ↓
Button "caught"
    ↓
callback() fires → main.js continues
```

---

## 🎯 Key Architectural Patterns

### **Module Pattern (IIFE)**
All JS files wrap code in immediately-invoked functions to avoid global scope pollution. Each module adds to `window.DPB` object:
```javascript
(function() {
  // Private code
  window.DPB.module = {
    // Public API
  };
})();
```

### **State Management**
- `DPB.state` — Runtime state (clicks, name)
- `DPB.store` — localStorage wrapper
- `step` in main.js — Sequence tracker

### **Async Handling**
- Signup returns promise
- `runaway` has callback
- `sleep()` utility for delays
- `locked` flag prevents race conditions

### **Progressive Enhancement**
- HTML works without JS
- Sounds optional (graceful fallback)
- localStorage optional (try/catch everywhere)
- Theme respects `prefers-reduced-motion`

---

## 🎨 Visual State Management

| Element | States |
|---------|--------|
| `#btn` | Normal, `.small`, `.sulk`, `.runner` |
| `body` | Default (dark), `.light`, `.shake` |
| `#overlay` | Hidden, `.show`, `.plain` |
| `#cookie` | Hidden, `.show` |
| `#signup` | Hidden, visible (modal) |
| `#toast` | Hidden, `.show` |
| `#mute` | 🔊 (unmuted), 🔇 (muted) |

---

## 💾 localStorage Keys

| Key | Value | Used By |
|-----|-------|---------|
| `dpb_total` | Number | Persistent click counter |
| `dpb_name` | String | User nickname from signup |
| `dpb_muted` | Boolean | Sound mute state |

---

## 📊 Statistics

| Metric | Count |
|--------|-------|
| Total Lines of Code | ~674 |
| HTML Elements | 16 main |
| CSS Rules/Selectors | 40+ |
| JavaScript Functions | 50+ |
| Sound Effects | 9 |
| Main Scenarios | 13 |
| Late Scenarios | 10+ |
| External Dependencies | 0 |

---

## ✨ Notable Features

✅ **Accessibility**
- `aria-live="polite"` for dynamic content
- `aria-modal="true"` for modals
- `aria-label` for icon buttons
- Reduced motion support

✅ **Performance**
- No external dependencies
- Sound synthesis (no mp3 files)
- Minimal CSS (~4KB)
- ~50KB total initial load

✅ **Humor-Driven Design**
- Contradictory password rules
- "Teapot" HTTP 418 error reference
- Cookie banner (both buttons identical)
- Impossible terms/conditions
- Button can escape clicks

✅ **User Experience**
- Persistent progress across sessions
- Personalized messages with username
- Progressive disclosure (13 main steps)
- Infinite post-game randomness
- Dark/light mode toggle

---

## 🚀 How to Run

```bash
# Local development (no Docker)
cd site
python -m http.server 8000
# Open http://localhost:8000

# Or with Docker
docker-compose up -d
# Open http://127.0.0.1:8081
```

---

## 🔧 To Modify

| Goal | File(s) | Action |
|------|---------|--------|
| Change colors | `style.css:1-2` | Modify CSS variables |
| Add sound | `sound.js` | Add new tone/function |
| Add joke/scenario | `jokes.js` | Add to `steps[]` or `late[]` |
| Change UI text | `index.html` | Modify HTML content |
| Add storage | `ui.js` | Extend `DPB.store` |
| Change validation | `signup.js` | Modify rules array |

---

**Generated:** 2026-10-16  
**Project Type:** Interactive Front-End Experience  
**License:** (Not specified)
