# KLS Electrical Simulation Backend

FastAPI backend for the KLS Smart Wiring + DC Simulation demo.

Main endpoints:

- `GET /api/health`
- `GET /api/v1/components`
- `POST /api/v1/validate`
- `POST /api/v1/simulate`
- compatibility: `POST /api/simulate/dc`
- compatibility: `POST /api/design/validate`

The solver derives electrical net topology from the submitted `nodes` and `edges` and ignores frontend display-only net names as a source of truth.
