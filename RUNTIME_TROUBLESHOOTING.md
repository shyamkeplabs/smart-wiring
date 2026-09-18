# KLS Runtime Troubleshooting

## Ports
- Frontend: http://localhost:5173
- Simulation backend: http://127.0.0.1:18080

## Clean start
1. Stop old Vite/Uvicorn windows.
2. Run `start_backend.bat`; it terminates a stale listener on 18080 first.
3. Confirm `http://127.0.0.1:18080/api/health` returns HTTP 200 and service `kls-electrical-simulation`.
4. Run `npm install` once and `npm run dev:force`.
5. Open `http://localhost:5173`.

## Diagnose a failed simulation
Run `diagnose_backend.bat`. It checks the health endpoint and an internal deterministic self-test. The simulation API catches unexpected engine exceptions and returns a structured error; the Uvicorn terminal logs the traceback for debugging.


## Why this release uses port 18080
The frontend now calls the simulation backend directly at `http://127.0.0.1:18080` instead of going through the Vite `/api` proxy. This isolates KLS from stale/other local services that may answer on port 8010. The backend also exposes `/api/health` and `/api/v1/self-test` for deterministic diagnostics.
