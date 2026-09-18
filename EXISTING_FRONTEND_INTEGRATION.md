# Integrating the backend into an existing KLS frontend

If your real KLS Studio frontend is already in another repository, you do not need to replace it with this demo UI.

1. Copy `backend/main.py` and `backend/requirements.txt` into a backend service.
2. Keep the existing React Flow nodes/edges schema. Each supported component should place electrical values in `data.properties`.
3. Ensure pin IDs map as follows:

| KLS UI pin | Electrical pin |
|---|---|
| Battery `pos` | positive |
| Battery `neg` | negative |
| Resistor `in` / `out` | a / b |
| Switch `in` / `out` | a / b |
| LED `in` / `out` | anode / cathode |
| Motor `in` / `out` | positive / negative |
| Ground `gnd` | gnd |
| Junction sides | one shared electrical node |

4. POST the actual `nodes` and `edges` from the canvas to `POST /api/v1/simulate`.
5. Render `branches`, `nets`, `warnings`, and `errors` in the existing simulation inspector.
6. For deployment, set `VITE_API_BASE_URL=https://<your-api-host>/api/v1` on the frontend. Local development can use the built-in Vite proxy.

Do not copy the frontend's display-only `netName` into solver state and treat it as electrical truth. The backend intentionally rebuilds connectivity from actual pins, wires, and junctions.
