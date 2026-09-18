# KLS Smart Wiring + DC Simulation v6

This is a standalone React + TypeScript + React Flow frontend integrated with a Python/FastAPI bounded DC simulation backend.

## Supported electrical model

- Battery — ideal DC voltage source
- Resistor — linear resistance / Ohm's law
- Switch — open or closed branch
- LED — bounded piecewise-linear forward-voltage model with current limit
- Motor — simple DC resistive load model
- Ground — 0 V reference

The frontend's wiring graph is sent to the backend. The backend derives its own electrical nets from actual pin connectivity instead of trusting UI net names.

## Run

> **v8 local backend port: 18080.** This intentionally avoids collisions with other KLS/portfolio services that often occupy port 18080.


### Terminal 1 — backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 18080
```

### Terminal 2 — frontend

From the project root:

```powershell
npm install
npm run dev:force
```

Open `http://localhost:5173`.

The Vite development server proxies `/api/*` requests to the dedicated FastAPI instance on port 18080. The frontend also attempts the legacy `/api/simulate/dc` route as a compatibility fallback.

## Demo flow

1. Keep the initial 9 V / 470 Ω / LED / motor circuit.
2. Click **SIMULATE**.
3. Confirm LED is ON at about 14.9 mA and motor current is about 300 mA.
4. Open the switch — both loads should turn OFF.
5. Change R1 from 470 Ω to 100 Ω — LED over-current warning should appear.
6. Disconnect GND — simulation should be blocked with a topology error.
7. Use **Junction** mode to split a wire or anchor a branch at a component terminal.
8. Click a wire to reveal edit dots and reshape it like a visual CAD/breadboard editor.

## Production notes

The simulation scope is intentionally bounded and deterministic. It is not a SPICE implementation and does not model AC, transient, temperature, motor back-EMF, semiconductor physics, or MCU execution.

Before deployment to a shared environment, pin the exact installed frontend dependencies with the generated lockfile and configure the API origin through the deployment platform rather than relying on the Vite proxy.


## Why v9 uses port 18080
Earlier local KLS iterations used port 8010. The observed browser error was HTTP 500 from `/api/health`, even though the v8 source health handler is deterministic and returns 200. That means the browser was reaching a different/stale process. v9 therefore isolates the simulator on port 18080 and the frontend calls it directly. The backend exposes `/api/health` and `/api/v1/self-test` so the exact process can be verified before simulation.
