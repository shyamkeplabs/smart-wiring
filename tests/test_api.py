import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402

client = TestClient(app)


def test_health():
    response = client.get('/api/health')
    assert response.status_code == 200
    assert response.json()['status'] == 'ok'


def test_simulate_endpoint():
    payload = json.loads((ROOT / 'examples' / 'led_circuit.json').read_text(encoding='utf-8'))
    response = client.post('/api/v1/simulate', json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'ok'
    assert body['summary']['branchCount'] == 5


def test_validate_endpoint():
    payload = json.loads((ROOT / 'examples' / 'led_circuit.json').read_text(encoding='utf-8'))
    response = client.post('/api/v1/validate', json=payload)
    assert response.status_code == 200
    assert response.json()['valid'] is True
