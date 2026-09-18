import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from main import SimulationPayload, simulate  # noqa: E402


def load(name: str):
    return json.loads((ROOT / "examples" / name).read_text(encoding="utf-8"))


def test_valid_led_circuit():
    result = simulate(SimulationPayload(**load("led_circuit.json")))
    assert result["status"] == "ok"
    led = next(branch for branch in result["branches"] if branch["type"] == "led")
    assert led["state"] == "on"
    assert 0.014 < led["currentA"] < 0.016


def test_switch_open_turns_loads_off():
    data = load("led_circuit.json")
    switch = next(node for node in data["nodes"] if node["data"]["kind"] == "switch")
    switch["data"]["properties"]["closed"] = False
    result = simulate(SimulationPayload(**data))
    assert result["status"] == "ok"
    led = next(branch for branch in result["branches"] if branch["type"] == "led")
    assert led["state"] == "off"
    assert led["currentA"] == pytest.approx(0.0)


def test_overcurrent_warning():
    data = load("led_circuit.json")
    resistor = next(node for node in data["nodes"] if node["data"]["kind"] == "resistor")
    resistor["data"]["properties"]["resistance"] = 100.0
    result = simulate(SimulationPayload(**data))
    assert result["status"] == "warning"
    assert any("exceeds" in warning for warning in result["warnings"])


def test_no_ground_is_rejected():
    data = load("led_circuit.json")
    data["nodes"] = [node for node in data["nodes"] if node["data"]["kind"] != "ground"]
    data["edges"] = [edge for edge in data["edges"] if edge["target"] != "gnd-1"]
    result = simulate(SimulationPayload(**data))
    assert result["status"] == "error"
    assert any("GND" in error for error in result["errors"])


def test_battery_short_is_rejected():
    data = load("led_circuit.json")
    data["edges"] = [
        {"id": "short", "source": "battery-1", "sourceHandle": "pos", "target": "battery-1", "targetHandle": "neg"}
    ]
    result = simulate(SimulationPayload(**data))
    assert result["status"] == "error"


def test_junction_branches_share_one_net():
    data = load('led_circuit.json')
    data['nodes'].append({"id": "junction-1", "type": "circuit", "data": {"kind": "junction", "label": "J1"}})
    data['edges'] = [edge for edge in data['edges'] if edge['id'] not in {'w2', 'w3'}]
    data['edges'].extend([
        {"id": "j1", "source": "switch-1", "sourceHandle": "out", "target": "junction-1", "targetHandle": "w"},
        {"id": "j2", "source": "junction-1", "sourceHandle": "e", "target": "resistor-1", "targetHandle": "in"},
        {"id": "j3", "source": "junction-1", "sourceHandle": "s", "target": "motor-1", "targetHandle": "in"}
    ])
    result = simulate(SimulationPayload(**data))
    assert result['status'] == 'ok'
    assert result['branches']
    net_map = result['netMap']
    assert net_map['pin:junction-1:junction'] == net_map['pin:resistor-1:a'] == net_map['pin:motor-1:positive']


def test_nc_connected_pin_is_rejected():
    data = load('led_circuit.json')
    battery = next(node for node in data['nodes'] if node['id'] == 'battery-1')
    battery['data']['noConnects'] = ['pos']
    result = simulate(SimulationPayload(**data))
    assert result['status'] == 'error'
    assert any('marked NC' in error for error in result['errors'])


def test_unconnected_palette_component_does_not_break_simulation():
    data = load('led_circuit.json')
    data['nodes'].append({
        'id': 'motor-unconnected',
        'data': {'kind': 'motor', 'label': 'M1', 'properties': {'resistance': 30, 'maxCurrent': 0.35}}
    })
    result = simulate(SimulationPayload(**data))
    assert result['status'] == 'ok'
    assert result['branches']


def test_active_island_without_ground_is_rejected():
    data = load('led_circuit.json')
    data['nodes'].append({
        'id': 'battery-2',
        'data': {'kind': 'battery', 'label': 'BAT2', 'properties': {'voltage': 5}}
    })
    data['nodes'].append({
        'id': 'resistor-2',
        'data': {'kind': 'resistor', 'label': 'R2', 'properties': {'resistance': 100}}
    })
    data['edges'].extend([
        {'id': 'iso1', 'source': 'battery-2', 'sourceHandle': 'pos', 'target': 'resistor-2', 'targetHandle': 'in'},
        {'id': 'iso2', 'source': 'resistor-2', 'sourceHandle': 'out', 'target': 'battery-2', 'targetHandle': 'neg'},
    ])
    result = simulate(SimulationPayload(**data))
    assert result['status'] == 'error'
    assert any('not connected to GND' in e for e in result['errors'])


def test_unconnected_palette_component_is_ignored_by_island_check():
    data = load('led_circuit.json')
    data['nodes'].append({
        'id': 'motor-unconnected',
        'data': {'kind': 'motor', 'label': 'M1', 'properties': {'resistance': 30, 'maxCurrent': 0.35}}
    })
    result = simulate(SimulationPayload(**data))
    assert result['status'] == 'ok'
