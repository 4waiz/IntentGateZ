# IntentGate Z console (frontend)

Operations console for the IntentGate Z gateway: a 3D emergency-operations city, a decision
inspector, the supervisor challenge workflow, an IBM Z proof page, the audit chain and a scenario
studio. Vite + React 18 + TypeScript (strict), three.js via @react-three/fiber and drei,
Tailwind CSS v4, motion, zustand, IBM Plex (self-hosted).

**The console never decides anything.** Every verdict, finding, route, vehicle movement, grant
and error shown on screen comes from the backend API. Vehicles move only along routes the backend
assigned (`route`, `route_times`, `start_xz`, `departed_at`), replayed client-side with the same
formula as `SimulationWorld.position()` and a measured server clock offset.

## Run (development)

Requires Node 20+ and the backend running locally.

```bash
# terminal 1: backend (from the repo root)
cd backend
INTENTGATE_DB_PATH=/tmp/ig-dev.db python -m uvicorn intentgate.api:app --host 127.0.0.1 --port 8000
#   PowerShell: $env:INTENTGATE_DB_PATH="$env:TEMP\ig-dev.db"; python -m uvicorn intentgate.api:app --host 127.0.0.1 --port 8000

# terminal 2: console
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api` (including the SSE stream) to `http://127.0.0.1:8000`. Point it
elsewhere with `INTENTGATE_DEV_BACKEND=http://host:port npm run dev`.

## Build and deploy

```bash
npm run build        # type-checks, then writes frontend/dist
npm run preview      # serves dist on :4173 with the same /api proxy
```

The SPA calls the API on its own origin (`/api`), so in production serve `dist/` from the
gateway: `INTENTGATE_STATIC_DIR=/path/to/frontend/dist` makes FastAPI serve it, or put Caddy in
front of both. To call a different origin set `VITE_API_BASE=https://gateway.example` at build
time (and allow that origin in `INTENTGATE_CORS_ORIGINS`).

**Build on x86_64 or arm64, then copy `dist/` to IBM LinuxONE.** Tailwind v4's native engine
(`@tailwindcss/oxide`) and `lightningcss` publish no `linux-s390x` binaries, so `npm run build`
does not run on s390x. The built output is plain static files and runs anywhere.

## Smoke test and screenshots

```bash
npm run smoke                                  # needs Chrome installed; backend + dev server running
SMOKE_URL=http://localhost:4173 npm run smoke  # against the production preview
SMOKE_BROWSER=/path/to/chromium npm run smoke  # explicit browser binary
```

Drives the real UI and API at 1440x900 and 1920x1080: all four scenarios, approve, tamper and
reuse (expects `409 grant_action_mismatch`), execute, replay (expects `409 grant_replayed`), safe
re-plan, trace, Granite explain (503 when not configured), IBM Z proof, audit verification,
Studio, and presentation mode. Screenshots are written to `screenshots/`. It fails on page errors
or wrong security-test codes and warns about backend 5xx responses.

## Using the console

| View | What it shows |
|---|---|
| Command | Scenario launcher, dispatch queue, units, signed operator intents, external feed (left); 3D city (centre); decision inspector with challenge workflow (right); decision timeline and audit events (bottom). |
| IBM Z Proof | Live host facts from `/api/platform`, runtime metrics, model execution facts, NNPA detection vs. utilisation as two separate claims, audit verification, benchmark files and charts from the ML pipeline. A non-s390x backend gets an amber "not running on IBM Z" banner. |
| Audit | Hash-chained audit records (session or all), chain verification, JSON export. |
| Studio | Compose any agent proposal against a registered intent (optionally with an untrusted feed instruction), change sandbox conditions (close roads, zero beds or ICU, divert), register custom intents. |

Keyboard: `P` toggles presentation mode, `Space` pauses (and, when paused, advances), `→`
advances, `Esc` exits. The quality preset (Low / Med / High) changes building density, pixel
ratio, antialiasing and enables bloom on High; it is remembered per browser.

Presentation mode resets the sandbox and runs the four scenarios through the real API: title
card, camera flight, the gateway's verdict, supervisor approve → execute → replay rejection for
the supply order, the ghost route and safe re-plan for the injection, and a closing card with the
audit-chain verification result.

## Code map

```
src/
  api/types.ts        API contracts derived from backend schemas and docs/api-samples
  api/client.ts       fetch wrapper: session header, 401 -> new sandbox, gateway error parsing
  store/store.ts      zustand store (server state + UI state)
  store/actions.ts    bootstrap, refresh, scenarios, challenge workflow, studio, explain
  store/live.ts       SSE (/api/events/stream) with 1 s state polling as fallback
  lib/sim.ts          client replica of SimulationWorld.position()
  lib/geo.ts          world frame (1 unit = 10 m, city centred, north = -Z)
  scene/              lazy-loaded 3D city: roads, instanced buildings, facilities, ambulances,
                      routes and ghost routes, incidents, closures, markers, effects, camera rig
  components/         top bar, command panel, inspector, challenge card, trace modal, timeline,
                      studio, presentation, IBM Z proof and audit views (lazy)
scripts/smoke.mjs     end-to-end smoke test and screenshot capture
```

State flow: `bootstrap()` checks `/health`, restores or creates the sandbox session
(sessionStorage), loads city, agents, scenarios and platform facts, then state and decisions.
Live updates arrive over SSE; any non-ping event refetches state, decisions and audit, and state
is polled every second regardless. Full decisions are fetched once per id and refetched when their
status changes. The inspector follows the latest decision unless one is pinned.
