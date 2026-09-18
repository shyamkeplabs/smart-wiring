# Architecture

```text
React + TypeScript + React Flow
        │
        │ nodes + edges + component properties
        ▼
Vite /api proxy
        │
        ▼
FastAPI
        │
        ├── topology validation
        ├── Union-Find net extraction
        ├── MNA DC solver
        ├── LED piecewise iteration
        └── component constraint checks
        │
        ▼
SimulationResult JSON
        │
        ▼
React inspector + canvas overlays
```

The key design rule is that frontend net labels are presentation metadata. Electrical connectivity is reconstructed from actual pin-to-pin edges and junction topology on the backend.
