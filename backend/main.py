from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any
import logging
import traceback

import numpy as np
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ConfigDict

APP_VERSION = "2.2.0"

app = FastAPI(
    title="KLS Electrical Simulation API",
    version=APP_VERSION,
    description="Deterministic bounded DC simulation for the KLS Smart Wiring demo.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LOGGER = logging.getLogger("kls.simulation")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

SUPPORTED = {"battery", "resistor", "switch", "led", "motor", "ground", "junction"}

PIN_DEFS: dict[str, tuple[str, ...]] = {
    "battery": ("positive", "negative"),
    "resistor": ("a", "b"),
    "switch": ("a", "b"),
    "led": ("anode", "cathode"),
    "motor": ("positive", "negative"),
    "ground": ("gnd",),
    "junction": ("junction", "n", "e", "s", "w", "in", "out"),
}

PIN_ALIASES = {
    "+": "positive",
    "p": "positive",
    "pos": "positive",
    "plus": "positive",
    "-": "negative",
    "minus": "negative",
    "neg": "negative",
    "gnd": "gnd",
    "ground": "gnd",
    "a": "a",
    "b": "b",
    "anode": "anode",
    "cathode": "cathode",
    "n": "n",
    "e": "e",
    "s": "s",
    "w": "w",
    "junction": "junction",
}


class SimulationPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)


class DesignPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    edges: list[dict[str, Any]] = Field(default_factory=list)


@dataclass(frozen=True)
class Branch:
    component_id: str
    label: str
    kind: str
    a_net: int
    b_net: int
    a_pin: str
    b_pin: str
    properties: dict[str, Any]


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def add(self, item: str) -> None:
        if item not in self.parent:
            self.parent[item] = item

    def find(self, item: str) -> str:
        self.add(item)
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != item:
            nxt = self.parent[item]
            self.parent[item] = root
            item = nxt
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def kind_of(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("kind") or data.get("type") or node.get("type") or "").strip().lower()


def label_of(node: dict[str, Any]) -> str:
    data = node.get("data") or {}
    return str(data.get("label") or node.get("id") or "Component")


def props_of(node: dict[str, Any]) -> dict[str, Any]:
    data = node.get("data") or {}
    props = data.get("properties")
    if isinstance(props, dict):
        return dict(props)
    legacy = data.get("settings")
    return dict(legacy) if isinstance(legacy, dict) else {}


def normalized_pin(handle: Any) -> str:
    raw = "" if handle is None else str(handle).strip().lower()
    return PIN_ALIASES.get(raw, raw)


def endpoint_key(node_id: str, pin: str) -> str:
    return f"pin:{node_id}:{normalized_pin(pin)}"


def canonical_pin(kind: str, pin: str) -> str:
    value = normalized_pin(pin)
    if kind == "junction":
        return "junction"
    if kind == "led":
        return {"a": "anode", "b": "cathode", "in": "anode", "out": "cathode", "left": "anode", "right": "cathode"}.get(value, value)
    if kind in {"resistor", "switch"}:
        return {"in": "a", "out": "b", "left": "a", "right": "b"}.get(value, value)
    if kind == "motor":
        return {"in": "positive", "out": "negative", "left": "positive", "right": "negative"}.get(value, value)
    if kind == "battery":
        return {"pos": "positive", "neg": "negative"}.get(value, value)
    return value


def numeric(props: dict[str, Any], *names: str, default: float) -> float:
    for name in names:
        if name not in props:
            continue
        try:
            value = float(props[name])
            if np.isfinite(value):
                return value
        except (TypeError, ValueError):
            continue
    return default


def boolean(props: dict[str, Any], *names: str, default: bool) -> bool:
    for name in names:
        if name not in props:
            continue
        value = props[name]
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"true", "1", "on", "closed", "yes"}
        return bool(value)
    return default


def build_nets(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, dict[str, Any]], dict[str, int], list[str]]:
    uf = UnionFind()
    node_map = {str(node.get("id")): node for node in nodes if node.get("id") is not None}
    errors: list[str] = []
    edge_to_root: dict[str, str] = {}

    for node_id, node in node_map.items():
        kind = kind_of(node)
        if kind not in SUPPORTED:
            errors.append(f"{label_of(node)} uses unsupported component type '{kind or 'unknown'}'.")
            continue
        for pin in PIN_DEFS.get(kind, ()):
            uf.add(endpoint_key(node_id, pin))
        if kind == "junction":
            center = endpoint_key(node_id, "junction")
            for pin in PIN_DEFS["junction"]:
                uf.union(center, endpoint_key(node_id, pin))

    for edge in edges:
        edge_id = str(edge.get("id") or "wire")
        source = edge.get("source")
        target = edge.get("target")
        if source is None or target is None:
            errors.append(f"{edge_id}: connection is missing an endpoint.")
            continue
        s_id, t_id = str(source), str(target)
        if s_id not in node_map or t_id not in node_map:
            errors.append(f"{edge_id}: connection references an unknown component.")
            continue
        if s_id == t_id:
            errors.append(f"{edge_id}: self-connections are not supported.")
            continue
        s_pin = canonical_pin(kind_of(node_map[s_id]), str(edge.get("sourceHandle") or edge.get("sourcePort") or ""))
        t_pin = canonical_pin(kind_of(node_map[t_id]), str(edge.get("targetHandle") or edge.get("targetPort") or ""))
        if s_pin not in PIN_DEFS.get(kind_of(node_map[s_id]), ()) and kind_of(node_map[s_id]) != "junction":
            errors.append(f"{edge_id}: invalid source terminal '{s_pin}'.")
            continue
        if t_pin not in PIN_DEFS.get(kind_of(node_map[t_id]), ()) and kind_of(node_map[t_id]) != "junction":
            errors.append(f"{edge_id}: invalid target terminal '{t_pin}'.")
            continue
        uf.union(endpoint_key(s_id, s_pin), endpoint_key(t_id, t_pin))

    ground_nodes = [node_id for node_id, node in node_map.items() if kind_of(node) == "ground"]
    if ground_nodes:
        ref = endpoint_key(ground_nodes[0], "gnd")
        for node_id in ground_nodes[1:]:
            uf.union(ref, endpoint_key(node_id, "gnd"))

    roots = sorted({uf.find(key) for key in uf.parent})
    root_to_net = {root: index for index, root in enumerate(roots)}
    net_map = {key: root_to_net[uf.find(key)] for key in uf.parent}

    for edge in edges:
        edge_id = str(edge.get("id") or "wire")
        source = edge.get("source")
        target = edge.get("target")
        if source is None or target is None:
            continue
        s_key = endpoint_key(str(source), canonical_pin(kind_of(node_map.get(str(source), {})), str(edge.get("sourceHandle") or "")))
        root = uf.find(s_key) if s_key in uf.parent else None
        if root is not None and root in root_to_net:
            edge_to_root[edge_id] = root

    return net_map, node_map, {edge_id: root_to_net[root] for edge_id, root in edge_to_root.items()}, errors


def pin_net(net_map: dict[str, int], node_id: str, pin: str) -> int | None:
    key = endpoint_key(node_id, pin)
    if key in net_map:
        return net_map[key]
    return net_map.get(endpoint_key(node_id, "junction"))


def validate_topology(payload: SimulationPayload) -> tuple[dict[str, int], dict[str, dict[str, Any]], list[str], list[str], set[int]]:
    net_map, node_map, edge_nets, errors = build_nets(payload.nodes, payload.edges)
    warnings: list[str] = []
    grounds: set[int] = set()

    inactive_components: list[str] = []
    for node_id, node in node_map.items():
        kind = kind_of(node)
        props = props_of(node)
        if kind == "ground":
            net = pin_net(net_map, node_id, "gnd")
            if net is not None:
                grounds.add(net)
            continue
        if kind == "junction":
            continue
        handles = PIN_DEFS[kind]
        connected_handles = [handle for handle in handles if pin_net(net_map, node_id, handle) is not None]
        # Completely unconnected palette components are inactive and should not
        # block an otherwise valid simulation. A partially wired component is
        # active and still requires every terminal to be connected.
        if not connected_handles:
            inactive_components.append(label_of(node))
        else:
            for handle in handles:
                if pin_net(net_map, node_id, handle) is None:
                    errors.append(f"{label_of(node)}: terminal '{handle}' is not connected.")
        raw_nc = props.get("noConnects")
        if not isinstance(raw_nc, list):
            raw_nc = (node.get("data") or {}).get("noConnects", [])
        if isinstance(raw_nc, list):
            for handle in raw_nc:
                canonical = canonical_pin(kind, str(handle))
                if pin_net(net_map, node_id, canonical) is not None:
                    errors.append(f"{label_of(node)}: terminal '{handle}' is marked NC but is connected.")

    if not grounds:
        errors.append("No GND/reference node is present. Add Ground to run a DC simulation.")
        return net_map, node_map, errors, warnings, grounds

    # Duplicate exact edges are warnings, not fatal, but they can create confusing topology.
    seen: set[tuple[Any, ...]] = set()
    for edge in payload.edges:
        key = (
            edge.get("source"),
            edge.get("sourceHandle"),
            edge.get("target"),
            edge.get("targetHandle"),
        )
        if key in seen:
            warnings.append(f"Duplicate connection detected on wire {edge.get('id', 'unknown')}.")
        seen.add(key)

    # Every electrical branch island must contain a ground-referenced node.
    # Only pins that are actually referenced by an edge are part of the active
    # circuit graph. Untouched palette components have isolated pin identities
    # in net_map, but they must not create singular solver islands.
    connected_pin_keys = set()
    for edge in payload.edges:
        source = edge.get("source")
        target = edge.get("target")
        if source is None or target is None:
            continue
        source_node = node_map.get(str(source))
        target_node = node_map.get(str(target))
        if source_node is None or target_node is None:
            continue
        source_pin = canonical_pin(kind_of(source_node), str(edge.get("sourceHandle") or edge.get("sourcePort") or ""))
        target_pin = canonical_pin(kind_of(target_node), str(edge.get("targetHandle") or edge.get("targetPort") or ""))
        connected_pin_keys.add(endpoint_key(str(source), source_pin))
        connected_pin_keys.add(endpoint_key(str(target), target_pin))

    branch_graph: dict[int, set[int]] = defaultdict(set)
    for node in node_map.values():
        kind = kind_of(node)
        if kind not in {"battery", "resistor", "switch", "led", "motor"}:
            continue
        node_id = str(node.get("id"))
        pins = PIN_DEFS[kind]
        if endpoint_key(node_id, pins[0]) not in connected_pin_keys and endpoint_key(node_id, pins[1]) not in connected_pin_keys:
            continue
        a = pin_net(net_map, node_id, pins[0])
        b = pin_net(net_map, node_id, pins[1])
        if a is None or b is None or a == b:
            continue
        branch_graph[a].add(b)
        branch_graph[b].add(a)

    visited: set[int] = set()
    for start in range(max(net_map.values(), default=-1) + 1):
        if start in visited or start not in branch_graph:
            continue
        queue = deque([start])
        component: set[int] = set()
        while queue:
            net = queue.popleft()
            if net in visited:
                continue
            visited.add(net)
            component.add(net)
            queue.extend(branch_graph[net] - visited)
        if not component & grounds:
            errors.append(f"Electrical island {min(component)} is not connected to GND.")

    # Component-level parameter validation.
    for node in node_map.values():
        kind = kind_of(node)
        p = props_of(node)
        label = label_of(node)
        if kind == "battery" and numeric(p, "voltage", "volts", default=9.0) <= 0:
            errors.append(f"{label}: battery voltage must be greater than 0 V.")
        if kind == "resistor" and numeric(p, "resistance", "ohms", default=470.0) <= 0:
            errors.append(f"{label}: resistance must be greater than 0 Ω.")
        if kind == "motor" and numeric(p, "resistance", "ohms", default=30.0) <= 0:
            errors.append(f"{label}: motor resistance must be greater than 0 Ω.")
        if kind == "led":
            if numeric(p, "forwardVoltage", "vf", default=2.0) <= 0:
                errors.append(f"{label}: LED forward voltage must be greater than 0 V.")
            if numeric(p, "maxCurrent", default=0.020) <= 0:
                errors.append(f"{label}: LED maximum current must be greater than 0 A.")

    edge_count = len(edge_nets)
    if edge_count == 0 and not errors:
        warnings.append("The circuit contains no wire connections.")
    return net_map, node_map, errors, warnings, grounds


def make_branches(payload: SimulationPayload, net_map: dict[str, int], node_map: dict[str, dict[str, Any]]) -> tuple[list[Branch], list[str]]:
    branches: list[Branch] = []
    errors: list[str] = []
    connected_pin_keys = set()
    for edge in payload.edges:
        source = edge.get("source")
        target = edge.get("target")
        if source is None or target is None:
            continue
        source_node = node_map.get(str(source))
        target_node = node_map.get(str(target))
        if source_node is None or target_node is None:
            continue
        source_pin = canonical_pin(kind_of(source_node), str(edge.get("sourceHandle") or edge.get("sourcePort") or ""))
        target_pin = canonical_pin(kind_of(target_node), str(edge.get("targetHandle") or edge.get("targetPort") or ""))
        connected_pin_keys.add(endpoint_key(str(source), source_pin))
        connected_pin_keys.add(endpoint_key(str(target), target_pin))

    for node_id, node in node_map.items():
        kind = kind_of(node)
        if kind in {"ground", "junction"}:
            continue
        pins = PIN_DEFS[kind]
        if endpoint_key(node_id, pins[0]) not in connected_pin_keys and endpoint_key(node_id, pins[1]) not in connected_pin_keys:
            continue
        a = pin_net(net_map, node_id, pins[0])
        b = pin_net(net_map, node_id, pins[1])
        if a is None or b is None:
            continue
        if a == b:
            if kind == "battery":
                errors.append(f"{label_of(node)}: battery terminals are shorted on the same net.")
            else:
                errors.append(f"{label_of(node)}: both terminals are connected to the same net.")
            continue
        branches.append(Branch(node_id, label_of(node), kind, a, b, pins[0], pins[1], props_of(node)))
    return branches, errors


def solve_mna(n_nets: int, branches: list[Branch], ground_net: int) -> tuple[np.ndarray, dict[str, float]]:
    voltage_sources = [branch for branch in branches if branch.kind == "battery"]
    active_nets = {ground_net}
    for branch in branches:
        active_nets.add(branch.a_net)
        active_nets.add(branch.b_net)
    non_ground = sorted(net for net in active_nets if net != ground_net)
    node_index = {net: index for index, net in enumerate(non_ground)}
    source_index = {branch.component_id: len(non_ground) + index for index, branch in enumerate(voltage_sources)}
    dimension = len(non_ground) + len(voltage_sources)
    if dimension == 0:
        return np.zeros(n_nets), {}

    A = np.zeros((dimension, dimension), dtype=float)
    z = np.zeros(dimension, dtype=float)

    def idx(net: int) -> int | None:
        return node_index.get(net)

    def stamp_conductance(a: int, b: int, conductance: float) -> None:
        ia, ib = idx(a), idx(b)
        if ia is not None:
            A[ia, ia] += conductance
        if ib is not None:
            A[ib, ib] += conductance
        if ia is not None and ib is not None:
            A[ia, ib] -= conductance
            A[ib, ia] -= conductance

    def stamp_current_source(a: int, b: int, current_a_to_b: float) -> None:
        ia, ib = idx(a), idx(b)
        if ia is not None:
            z[ia] -= current_a_to_b
        if ib is not None:
            z[ib] += current_a_to_b

    for branch in branches:
        a, b, p = branch.a_net, branch.b_net, branch.properties
        if branch.kind == "battery":
            continue
        if branch.kind == "resistor":
            r = max(numeric(p, "resistance", "ohms", default=470.0), 1e-9)
            stamp_conductance(a, b, 1.0 / r)
        elif branch.kind == "switch":
            if boolean(p, "closed", "isClosed", default=True):
                stamp_conductance(a, b, 1_000.0)
        elif branch.kind == "motor":
            r = max(numeric(p, "resistance", "ohms", default=30.0), 1e-9)
            stamp_conductance(a, b, 1.0 / r)
        elif branch.kind == "led":
            state = str(p.get("_state", "off"))
            if state == "on":
                ron = max(numeric(p, "onResistance", "dynamicResistance", default=5.0), 1e-6)
                vf = numeric(p, "forwardVoltage", "vf", default=2.0)
                g = 1.0 / ron
                stamp_conductance(a, b, g)
                # I = (Va - Vb - Vf)/Ron; equivalent current source is -Vf/Ron from a to b.
                stamp_current_source(a, b, -vf * g)
            else:
                roff = max(numeric(p, "offResistance", default=1e9), 1e6)
                stamp_conductance(a, b, 1.0 / roff)

    for branch in voltage_sources:
        row = source_index[branch.component_id]
        ia, ib = idx(branch.a_net), idx(branch.b_net)
        if ia is not None:
            A[ia, row] += 1.0
            A[row, ia] += 1.0
        if ib is not None:
            A[ib, row] -= 1.0
            A[row, ib] -= 1.0
        z[row] = numeric(branch.properties, "voltage", "volts", default=9.0)

    try:
        solution = np.linalg.solve(A, z)
    except np.linalg.LinAlgError as exc:
        raise ValueError("The circuit matrix is singular. Check for floating electrical islands or invalid connections.") from exc

    if not np.isfinite(solution).all():
        raise ValueError("The solver returned non-finite values.")

    voltages = np.zeros(n_nets, dtype=float)
    for net, index in node_index.items():
        voltages[net] = solution[index]
    currents = {branch.component_id: float(solution[source_index[branch.component_id]]) for branch in voltage_sources}
    return voltages, currents


def simulate(payload: SimulationPayload) -> dict[str, Any]:
    net_map, node_map, topology_errors, warnings, ground_nets = validate_topology(payload)
    branches, branch_errors = make_branches(payload, net_map, node_map)
    errors = list(topology_errors) + list(branch_errors)

    if errors:
        return result_payload(
            status="error",
            errors=errors,
            warnings=warnings,
            nets={},
            branches=[],
            net_map=net_map,
            node_map=node_map,
            summary={"netCount": len(set(net_map.values())), "branchCount": len(branches)},
        )

    ground_net = min(ground_nets)
    for branch in branches:
        if branch.kind == "led":
            branch.properties["_state"] = "off"

    voltages = np.zeros(max(net_map.values(), default=-1) + 1, dtype=float)
    source_currents: dict[str, float] = {}

    try:
        last_states: dict[str, str] = {}
        for _ in range(12):
            voltages, source_currents = solve_mna(len(voltages), branches, ground_net)
            changed = False
            for branch in branches:
                if branch.kind != "led":
                    continue
                vf = numeric(branch.properties, "forwardVoltage", "vf", default=2.0)
                candidate = "on" if (voltages[branch.a_net] - voltages[branch.b_net]) >= vf else "off"
                if last_states.get(branch.component_id) != candidate:
                    last_states[branch.component_id] = candidate
                    branch.properties["_state"] = candidate
                    changed = True
            if not changed:
                break
        voltages, source_currents = solve_mna(len(voltages), branches, ground_net)
    except ValueError as exc:
        return result_payload(
            status="error",
            errors=[str(exc)],
            warnings=warnings,
            nets={str(net): {"voltage": 0.0, "isGround": net == ground_net} for net in range(len(voltages))},
            branches=[],
            net_map=net_map,
            node_map=node_map,
            summary={"netCount": len(voltages), "branchCount": len(branches)},
        )

    branch_results: list[dict[str, Any]] = []
    for branch in branches:
        va = float(voltages[branch.a_net])
        vb = float(voltages[branch.b_net])
        dv = va - vb
        p = branch.properties
        if branch.kind == "battery":
            source_current = source_currents.get(branch.component_id, 0.0)
            branch_results.append({
                "id": branch.component_id,
                "label": branch.label,
                "type": branch.kind,
                "fromPin": branch.a_pin,
                "toPin": branch.b_pin,
                "voltageV": dv,
                "currentA": source_current,
                "currentAbsA": abs(source_current),
                "currentMa": abs(source_current) * 1000.0,
                "powerW": abs(dv * source_current),
                "status": "source",
            })
        elif branch.kind == "resistor":
            r = max(numeric(p, "resistance", "ohms", default=470.0), 1e-9)
            current = dv / r
            branch_results.append({
                "id": branch.component_id,
                "label": branch.label,
                "type": branch.kind,
                "fromPin": branch.a_pin,
                "toPin": branch.b_pin,
                "voltageV": dv,
                "currentA": current,
                "currentAbsA": abs(current),
                "currentMa": abs(current) * 1000.0,
                "powerW": abs(dv * current),
                "resistanceOhms": r,
                "status": "ok",
            })
        elif branch.kind == "switch":
            closed = boolean(p, "closed", "isClosed", default=True)
            r = 1e-3 if closed else 1e12
            current = dv / r
            branch_results.append({
                "id": branch.component_id,
                "label": branch.label,
                "type": branch.kind,
                "fromPin": branch.a_pin,
                "toPin": branch.b_pin,
                "voltageV": dv,
                "currentA": current,
                "currentAbsA": abs(current),
                "currentMa": abs(current) * 1000.0,
                "closed": closed,
                "status": "closed" if closed else "open",
            })
        elif branch.kind == "motor":
            r = max(numeric(p, "resistance", "ohms", default=30.0), 1e-9)
            current = dv / r
            max_current = max(numeric(p, "maxCurrent", default=0.35), 1e-9)
            status = "warning" if abs(current) > max_current else "ok"
            if status == "warning":
                warnings.append(f"{branch.label}: current {abs(current) * 1000:.1f} mA exceeds the configured {max_current * 1000:.1f} mA limit.")
            branch_results.append({
                "id": branch.component_id,
                "label": branch.label,
                "type": branch.kind,
                "fromPin": branch.a_pin,
                "toPin": branch.b_pin,
                "voltageV": dv,
                "currentA": current,
                "currentAbsA": abs(current),
                "currentMa": abs(current) * 1000.0,
                "powerW": abs(dv * current),
                "resistanceOhms": r,
                "maxCurrentA": max_current,
                "status": status,
            })
        elif branch.kind == "led":
            state = str(p.get("_state", "off"))
            vf = numeric(p, "forwardVoltage", "vf", default=2.0)
            max_current = max(numeric(p, "maxCurrent", default=0.020), 1e-9)
            ron = max(numeric(p, "onResistance", "dynamicResistance", default=5.0), 1e-6)
            current = max(0.0, (dv - vf) / ron) if state == "on" else 0.0
            status = "warning" if current > max_current else state
            if current > max_current:
                warnings.append(f"{branch.label}: current {current * 1000:.1f} mA exceeds the configured {max_current * 1000:.1f} mA limit.")
            branch_results.append({
                "id": branch.component_id,
                "label": branch.label,
                "type": branch.kind,
                "fromPin": branch.a_pin,
                "toPin": branch.b_pin,
                "voltageV": dv,
                "currentA": current,
                "currentAbsA": abs(current),
                "currentMa": abs(current) * 1000.0,
                "powerW": abs(max(0.0, dv * current)),
                "forwardVoltageV": vf,
                "maxCurrentA": max_current,
                "state": state,
                "status": status,
            })

    # Detect source shorts using source current magnitude as a guarded secondary check.
    for branch in branches:
        if branch.kind != "battery":
            continue
        current = abs(source_currents.get(branch.component_id, 0.0))
        threshold = max(numeric(branch.properties, "shortCircuitCurrent", default=2.0), 0.1)
        if current > threshold:
            errors.append(f"{branch.label}: source current {current:.2f} A indicates a likely short circuit.")

    nets = {
        str(net): {
            "voltage": float(voltages[net]),
            "isGround": net == ground_net,
        }
        for net in range(len(voltages))
    }
    status = "error" if errors else ("warning" if warnings else "ok")
    summary = {
        "netCount": len(voltages),
        "branchCount": len(branch_results),
        "groundNet": ground_net,
        "maxVoltageV": float(np.max(np.abs(voltages))) if len(voltages) else 0.0,
        "totalCurrentMa": float(sum(result.get("currentMa", 0.0) for result in branch_results if result["type"] == "battery")),
    }
    return result_payload(status, errors, warnings, nets, branch_results, net_map, node_map, summary)


def result_payload(
    status: str,
    errors: list[str],
    warnings: list[str],
    nets: dict[str, Any],
    branches: list[dict[str, Any]],
    net_map: dict[str, int],
    node_map: dict[str, dict[str, Any]],
    summary: dict[str, Any],
) -> dict[str, Any]:
    return {
        "ok": status != "error",
        "status": status,
        "errors": list(dict.fromkeys(errors)),
        "warnings": list(dict.fromkeys(warnings)),
        "nets": nets,
        "branches": branches,
        "netMap": net_map,
        "summary": summary,
        "version": APP_VERSION,
    }


@app.get("/")
def root() -> dict[str, Any]:
    return {"service": "kls-electrical-simulation", "version": APP_VERSION, "docs": "/docs", "health": "/api/health", "simulate": "POST /api/v1/simulate"}


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "kls-electrical-simulation", "version": APP_VERSION, "port": 18080}


@app.get("/api/v1/status")
def status() -> dict[str, Any]:
    return {"status": "ok", "service": "kls-electrical-simulation", "version": APP_VERSION, "simulationEndpoint": "/api/v1/simulate", "supported": sorted(SUPPORTED - {"junction"})}


@app.get("/api/v1/components")
def components() -> dict[str, Any]:
    return {
        "components": [
            {"type": "battery", "pins": ["positive", "negative"], "defaults": {"voltage": 9.0}},
            {"type": "resistor", "pins": ["a", "b"], "defaults": {"resistance": 470.0}},
            {"type": "switch", "pins": ["a", "b"], "defaults": {"closed": True}},
            {"type": "led", "pins": ["anode", "cathode"], "defaults": {"forwardVoltage": 2.0, "maxCurrent": 0.020, "onResistance": 5.0}},
            {"type": "motor", "pins": ["positive", "negative"], "defaults": {"resistance": 30.0, "maxCurrent": 0.35}},
            {"type": "ground", "pins": ["gnd"], "defaults": {"voltage": 0.0}},
        ]
    }


@app.post("/api/v1/validate")
def validate_design(payload: DesignPayload) -> dict[str, Any]:
    simulation_payload = SimulationPayload(nodes=payload.nodes, edges=payload.edges)
    net_map, node_map, errors, warnings, grounds = validate_topology(simulation_payload)
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "netCount": len(set(net_map.values())),
        "grounded": bool(grounds),
    }


@app.post("/api/v1/simulate")
def simulate_dc_v1(payload: SimulationPayload) -> dict[str, Any]:
    try:
        return simulate(payload)
    except Exception as exc:
        LOGGER.error("Unhandled simulation exception: %s\n%s", exc, traceback.format_exc())
        return {
            "ok": False,
            "status": "error",
            "errors": [f"Simulation engine error: {exc}"],
            "warnings": [],
            "nets": {},
            "branches": [],
            "netMap": {},
            "summary": {"netCount": 0, "branchCount": 0},
            "version": APP_VERSION,
        }


@app.get("/api/v1/self-test")
def self_test() -> dict[str, Any]:
    sample = {
        "nodes": [
            {"id": "battery-1", "data": {"kind": "battery", "label": "BAT1", "properties": {"voltage": 9}}},
            {"id": "switch-1", "data": {"kind": "switch", "label": "SW1", "properties": {"closed": True}}},
            {"id": "resistor-1", "data": {"kind": "resistor", "label": "R1", "properties": {"resistance": 470}}},
            {"id": "led-1", "data": {"kind": "led", "label": "LED1", "properties": {"forwardVoltage": 2, "maxCurrent": 0.02, "onResistance": 5}}},
            {"id": "gnd-1", "data": {"kind": "ground", "label": "GND", "properties": {}}},
        ],
        "edges": [
            {"id": "w1", "source": "battery-1", "sourceHandle": "pos", "target": "switch-1", "targetHandle": "in"},
            {"id": "w2", "source": "switch-1", "sourceHandle": "out", "target": "resistor-1", "targetHandle": "in"},
            {"id": "w3", "source": "resistor-1", "sourceHandle": "out", "target": "led-1", "targetHandle": "in"},
            {"id": "w4", "source": "led-1", "sourceHandle": "out", "target": "gnd-1", "targetHandle": "gnd"},
            {"id": "w5", "source": "battery-1", "sourceHandle": "neg", "target": "gnd-1", "targetHandle": "gnd"},
        ],
    }
    try:
        result = simulate(SimulationPayload(**sample))
        return {"status": "ok" if result["status"] in {"ok", "warning"} else "error", "simulation": result, "service": "kls-electrical-simulation", "version": APP_VERSION}
    except Exception as exc:
        LOGGER.error("Self-test failed: %s\n%s", exc, traceback.format_exc())
        return {"status": "error", "error": str(exc), "version": APP_VERSION}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):
    LOGGER.error("Unhandled request error on %s: %s\n%s", request.url.path, exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={
            "ok": False,
            "error": "INTERNAL_SERVER_ERROR",
            "detail": str(exc),
            "service": "kls-electrical-simulation",
            "version": APP_VERSION,
        },
    )


# Backwards-compatible routes for earlier KLS prototypes.
@app.post("/api/simulate/dc")
def simulate_dc_legacy(payload: SimulationPayload) -> dict[str, Any]:
    return simulate_dc_v1(payload)


@app.post("/api/design/validate")
def validate_design_legacy(payload: DesignPayload) -> dict[str, Any]:
    result = validate_design(payload)
    return {
        "valid": result["valid"],
        "invalidEdges": [],
        "warnings": result["warnings"],
        "message": "Design connectivity is structurally valid." if result["valid"] else "Design validation found errors.",
        "errors": result["errors"],
    }
