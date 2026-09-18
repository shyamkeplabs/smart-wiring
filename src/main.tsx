import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  BaseEdge,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  EdgeProps,
  Handle,
  MiniMap,
  Node,
  NodeChange,
  NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  Check,
  CircleHelp,
  CircleSlash2,
  CircuitBoard,
  Download,
  FileJson,
  GitBranch,
  HardDrive,
  Link2,
  Menu,
  Moon,
  MousePointer2,
  Plus,
  Redo2,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Tag,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import './styles.css';

type ComponentKind = 'battery' | 'resistor' | 'led' | 'switch' | 'motor' | 'ground' | 'junction';
type WireMode = 'smart' | 'orthogonal' | 'diagonal' | 'curved' | 'bus' | 'custom';
type SignalType = 'Power' | 'Ground' | 'Signal' | 'Output' | 'Bus';
type Point = { x: number; y: number };
type Rect = { x: number; y: number; width: number; height: number };

type ComponentProperties = {
  voltage?: number;
  resistance?: number;
  closed?: boolean;
  forwardVoltage?: number;
  maxCurrent?: number;
  onResistance?: number;
  ratedVoltage?: number;
  noConnects?: string[];
};

type SimulationState = {
  status: 'ok' | 'warning' | 'error';
  currentMa?: number;
  voltageV?: number;
  powerW?: number;
  state?: string;
};

type ComponentData = {
  kind: ComponentKind;
  label: string;
  description: string;
  status?: string;
  properties?: ComponentProperties;
  noConnects?: string[];
  netName?: string;
  simulation?: SimulationState;
  onPinPointerDown?: (nodeId: string, handleId: string, event: React.PointerEvent<HTMLDivElement>) => void;
};

type WireData = {
  netName?: string;
  signal?: SignalType;
  mode?: WireMode;
  showLabel?: boolean;
  width?: number;
  customPath?: Point[];
  onWireEditStart?: (edgeId: string) => void;
  onWireEditChange?: (edgeId: string, nextCustomPath: Point[]) => void;
  onWireEditEnd?: (edgeId: string) => void;
};

type CircuitNode = Node<ComponentData>;
type CircuitEdge = Edge<WireData>;
type Snapshot = { nodes: CircuitNode[]; edges: CircuitEdge[] };

type SimulationBranch = {
  id: string;
  label: string;
  type: ComponentKind;
  fromPin: string;
  toPin: string;
  voltageV: number;
  currentA: number;
  currentAbsA: number;
  currentMa: number;
  powerW?: number;
  resistanceOhms?: number;
  closed?: boolean;
  state?: string;
  status: string;
};

type SimulationResult = {
  ok: boolean;
  status: 'ok' | 'warning' | 'error';
  errors: string[];
  warnings: string[];
  nets: Record<string, { voltage: number; isGround: boolean }>;
  branches: SimulationBranch[];
  summary: { netCount: number; branchCount: number; groundNet?: number; maxVoltageV?: number; totalCurrentMa?: number };
  version?: string;
};

const STORAGE_KEY = 'kls-smart-wiring-simulation-v9';
const API_ORIGIN = (import.meta.env.VITE_SIMULATION_BACKEND_URL || 'http://127.0.0.1:18080').replace(/\/$/, '');
const API_URL = `${API_ORIGIN}/api/v1`;
const HEALTH_URL = `${API_ORIGIN}/api/health`;
const LEGACY_API_URL = `${API_ORIGIN}/api`;

function safeStorageSet(key: string, value: string) { try { localStorage.setItem(key, value); } catch (error) { console.warn('[KLS storage]', error); } }

const palette = [
  { kind: 'battery' as const, label: 'Battery', desc: '9 V DC source', tone: 'power', prefix: 'BAT' },
  { kind: 'resistor' as const, label: 'Resistor', desc: '470 Ω current limit', tone: 'passive', prefix: 'R' },
  { kind: 'led' as const, label: 'LED', desc: 'Red output indicator', tone: 'output', prefix: 'LED' },
  { kind: 'switch' as const, label: 'Switch', desc: 'Push-button input', tone: 'input', prefix: 'SW' },
  { kind: 'motor' as const, label: 'Motor', desc: '30 Ω DC actuator', tone: 'actuator', prefix: 'M' },
  { kind: 'ground' as const, label: 'Ground', desc: '0 V reference', tone: 'ground', prefix: 'GND' },
];

const initialNodes: CircuitNode[] = [
  {
    id: 'battery-1', type: 'circuit', position: { x: 70, y: 250 },
    data: { kind: 'battery', label: 'BAT1', description: '9 V DC source', status: 'Power source', properties: { voltage: 9 } },
  },
  {
    id: 'switch-1', type: 'circuit', position: { x: 300, y: 170 },
    data: { kind: 'switch', label: 'SW1', description: 'Push-button input', status: 'Closed', properties: { closed: true } },
  },
  {
    id: 'resistor-1', type: 'circuit', position: { x: 565, y: 170 },
    data: { kind: 'resistor', label: 'R1', description: '470 Ω current limit', status: 'Passive', properties: { resistance: 470 } },
  },
  {
    id: 'led-1', type: 'circuit', position: { x: 830, y: 170 },
    data: { kind: 'led', label: 'LED1', description: 'Red output indicator', status: 'Output', properties: { forwardVoltage: 2, maxCurrent: 0.02, onResistance: 5 } },
  },
  {
    id: 'motor-1', type: 'circuit', position: { x: 565, y: 380 },
    data: { kind: 'motor', label: 'M1', description: '30 Ω DC actuator', status: 'Actuator', properties: { resistance: 30, maxCurrent: 0.35, ratedVoltage: 9 } },
  },
  {
    id: 'ground-1', type: 'circuit', position: { x: 900, y: 440 },
    data: { kind: 'ground', label: 'GND', description: '0 V reference', status: 'Power net', properties: {} },
  },
];

const initialEdges: CircuitEdge[] = [
  { id: 'w1', source: 'battery-1', sourceHandle: 'pos', target: 'switch-1', targetHandle: 'in', type: 'wire', data: { netName: 'VCC', signal: 'Power', mode: 'smart' } },
  { id: 'w2', source: 'switch-1', sourceHandle: 'out', target: 'resistor-1', targetHandle: 'in', type: 'wire', data: { netName: 'SW_OUT', signal: 'Signal', mode: 'orthogonal' } },
  { id: 'w3', source: 'resistor-1', sourceHandle: 'out', target: 'led-1', targetHandle: 'in', type: 'wire', data: { netName: 'LED_A', signal: 'Signal', mode: 'diagonal' } },
  { id: 'w4', source: 'led-1', sourceHandle: 'out', target: 'ground-1', targetHandle: 'gnd', type: 'wire', data: { netName: 'GND', signal: 'Ground', mode: 'curved' } },
  { id: 'w5', source: 'battery-1', sourceHandle: 'neg', target: 'ground-1', targetHandle: 'gnd', type: 'wire', data: { netName: 'GND', signal: 'Ground', mode: 'smart' } },
];

function defaultProperties(kind: ComponentKind): ComponentProperties {
  switch (kind) {
    case 'battery': return { voltage: 9 };
    case 'resistor': return { resistance: 470 };
    case 'switch': return { closed: true };
    case 'led': return { forwardVoltage: 2, maxCurrent: 0.02, onResistance: 5 };
    case 'motor': return { resistance: 30, maxCurrent: 0.35, ratedVoltage: 9 };
    default: return {};
  }
}

function componentSvg(kind: ComponentKind) {
  if (kind === 'junction') return '';
  return `/assets/components/${kind}.svg`;
}

function signalColor(signal?: SignalType) {
  switch (signal) {
    case 'Power': return '#eab308';
    case 'Ground': return '#2563eb';
    case 'Output': return '#16a34a';
    case 'Bus': return '#8b5cf6';
    default: return '#f59e0b';
  }
}

function cloneSnapshot(nodes: CircuitNode[], edges: CircuitEdge[]): Snapshot {
  const cleanNodes = nodes.map((node) => {
    const { onPinPointerDown: _ignored, ...data } = node.data;
    void _ignored;
    return { ...node, selected: false, dragging: false, data: { ...data, noConnects: [...(node.data.noConnects ?? [])], properties: { ...(node.data.properties ?? {}) } } };
  });
  const cleanEdges = edges.map((edge) => ({ ...edge, selected: false, data: { ...edge.data, customPath: edge.data?.customPath?.map((point) => ({ ...point })) } }));
  return { nodes: cleanNodes, edges: cleanEdges };
}

function nodeRect(node: Node) {
  const width = node.measured?.width ?? node.width ?? (node.data?.kind === 'ground' ? 160 : node.data?.kind === 'junction' ? 14 : 190);
  const height = node.measured?.height ?? node.height ?? (node.data?.kind === 'junction' ? 14 : 70);
  return { x: node.position.x, y: node.position.y, width, height };
}

function pointsEqual(a: Point, b: Point) { return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5; }
function pointDistance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }
function polylineLength(points: Point[]) { let total = 0; for (let i = 1; i < points.length; i += 1) total += pointDistance(points[i - 1], points[i]); return total; }

function segmentHitsRect(a: Point, b: Point, rect: Rect, padding = 14) {
  const left = rect.x - padding; const right = rect.x + rect.width + padding;
  const top = rect.y - padding; const bottom = rect.y + rect.height + padding;
  if (Math.abs(a.y - b.y) < 0.5) return a.y >= top && a.y <= bottom && Math.max(Math.min(a.x, b.x), left) <= Math.min(Math.max(a.x, b.x), right);
  if (Math.abs(a.x - b.x) < 0.5) return a.x >= left && a.x <= right && Math.max(Math.min(a.y, b.y), top) <= Math.min(Math.max(a.y, b.y), bottom);
  return !(Math.max(a.x, b.x) < left || Math.min(a.x, b.x) > right || Math.max(a.y, b.y) < top || Math.min(a.y, b.y) > bottom);
}

function compressCollinear(points: Point[]) {
  const output: Point[] = [];
  points.forEach((point) => {
    const prev = output[output.length - 1];
    if (prev && pointsEqual(prev, point)) return;
    if (output.length >= 2) {
      const a = output[output.length - 2]; const b = output[output.length - 1];
      const horizontal = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - point.y) < 0.5;
      const vertical = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - point.x) < 0.5;
      if (horizontal || vertical) output[output.length - 1] = point; else output.push(point);
    } else output.push(point);
  });
  return output;
}

function roundedPath(points: Point[], radius = 8) {
  const clean = compressCollinear(points);
  if (clean.length < 2) return '';
  if (clean.length === 2) return `M ${clean[0].x} ${clean[0].y} L ${clean[1].x} ${clean[1].y}`;
  let d = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i += 1) {
    const prev = clean[i - 1], current = clean[i], next = clean[i + 1];
    const inLen = pointDistance(current, prev), outLen = pointDistance(next, current);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const inPoint = { x: current.x + (prev.x - current.x) * (r / Math.max(inLen, 0.001)), y: current.y + (prev.y - current.y) * (r / Math.max(inLen, 0.001)) };
    const outPoint = { x: current.x + (next.x - current.x) * (r / Math.max(outLen, 0.001)), y: current.y + (next.y - current.y) * (r / Math.max(outLen, 0.001)) };
    d += ` L ${inPoint.x} ${inPoint.y} Q ${current.x} ${current.y} ${outPoint.x} ${outPoint.y}`;
  }
  const last = clean[clean.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function directOrthogonal(source: Point, target: Point) {
  const horizontalFirst = [source, { x: target.x, y: source.y }, target];
  const verticalFirst = [source, { x: source.x, y: target.y }, target];
  return Math.abs(target.x - source.x) >= Math.abs(target.y - source.y) ? horizontalFirst : verticalFirst;
}

function smartRoute(source: Point, target: Point, obstacles: Rect[]) {
  const xs = Array.from(new Set([source.x, target.x, ...obstacles.flatMap((r) => [r.x - 30, r.x + r.width + 30])])).sort((a, b) => a - b);
  const ys = Array.from(new Set([source.y, target.y, ...obstacles.flatMap((r) => [r.y - 30, r.y + r.height + 30])])).sort((a, b) => a - b);
  const candidates: Point[][] = [directOrthogonal(source, target)];
  xs.forEach((x) => candidates.push([source, { x, y: source.y }, { x, y: target.y }, target]));
  ys.forEach((y) => candidates.push([source, { x: source.x, y }, { x: target.x, y }, target]));
  let best: { points: Point[]; score: number } | null = null;
  for (const raw of candidates) {
    const points = compressCollinear(raw);
    let blocked = false;
    for (const rect of obstacles) {
      for (let i = 1; i < points.length; i += 1) {
        if (segmentHitsRect(points[i - 1], points[i], rect)) { blocked = true; break; }
      }
      if (blocked) break;
    }
    if (blocked) continue;
    const score = polylineLength(points) + (points.length - 2) * 32;
    if (!best || score < best.score) best = { points, score };
  }
  return best?.points ?? directOrthogonal(source, target);
}

function curveControlPoint(source: Point, target: Point) {
  const dx = target.x - source.x, dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 + Math.sign(dy || 1) * Math.max(55, Math.abs(dx) * 0.28) };
  return { x: (source.x + target.x) / 2 + Math.sign(dx || 1) * Math.max(55, Math.abs(dy) * 0.28), y: (source.y + target.y) / 2 };
}

function routeForMode(mode: WireMode, source: Point, target: Point, obstacles: Rect[], customPath?: Point[]) {
  if (mode === 'custom' && customPath?.length) {
    const pts = [source, ...customPath, target];
    return { points: pts, path: roundedPath(pts, 7) };
  }
  if (mode === 'curved') {
    const control = customPath?.[0] ?? curveControlPoint(source, target);
    return { points: [source, control, target], path: `M ${source.x} ${source.y} Q ${control.x} ${control.y} ${target.x} ${target.y}` };
  }
  if (customPath?.length) {
    const pts = [source, ...customPath, target];
    return { points: pts, path: roundedPath(pts, mode === 'smart' ? 9 : 4) };
  }
  if (mode === 'diagonal') {
    const dx = target.x - source.x, dy = target.y - source.y, step = Math.min(Math.abs(dx), Math.abs(dy));
    const diagonal = { x: source.x + Math.sign(dx) * step, y: source.y + Math.sign(dy) * step };
    const pts = step < 8 ? [source, target] : [source, diagonal, target];
    return { points: pts, path: roundedPath(pts, 4) };
  }
  const pts = mode === 'smart' || mode === 'bus' ? smartRoute(source, target, obstacles) : directOrthogonal(source, target);
  return { points: pts, path: roundedPath(pts, mode === 'smart' ? 9 : 4) };
}

function getNodePinPoint(node: Node | undefined, handleId: string | null | undefined): Point {
  if (!node) return { x: 0, y: 0 };
  const r = nodeRect(node);
  switch (handleId) {
    case 'pos': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'neg': case 'in': case 'a': case 'anode': return { x: r.x, y: r.y + r.height / 2 };
    case 'out': case 'b': case 'cathode': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'gnd': return { x: r.x + r.width / 2, y: r.y };
    case 'n': return { x: r.x + r.width / 2, y: r.y };
    case 's': return { x: r.x + r.width / 2, y: r.y + r.height };
    case 'e': return { x: r.x + r.width, y: r.y + r.height / 2 };
    case 'w': return { x: r.x, y: r.y + r.height / 2 };
    default: return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
}

function nearestJunctionSide(from: Point, junction: Point) {
  const dx = from.x - junction.x, dy = from.y - junction.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'w' : 'e';
  return dy < 0 ? 'n' : 's';
}

function projectPointToSegment(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 < 0.001) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function nearestSegmentIndex(point: Point, points: Point[]) {
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const d = pointDistance(point, projectPointToSegment(point, points[i], points[i + 1]));
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}

function insertBend(points: Point[], position: Point) {
  const index = nearestSegmentIndex(position, points);
  const a = points[index], b = points[index + 1], projected = projectPointToSegment(position, a, b);
  return [...points.slice(0, index + 1), projected, ...points.slice(index + 1)];
}

function shiftedOrthogonalSegment(a: Point, b: Point, position: Point) {
  if (Math.abs(a.y - b.y) <= Math.abs(a.x - b.x)) return [a, { x: position.x, y: position.y }, { x: b.x, y: position.y }, b];
  return [a, { x: position.x, y: position.y }, { x: position.x, y: b.y }, b];
}

function WireEdge(props: EdgeProps<CircuitEdge>) {
  const { sourceX, sourceY, targetX, targetY, data, selected, source, target, animated, id } = props;
  const { getNodes, screenToFlowPosition } = useReactFlow();
  const nodes = getNodes();
  const mode = data?.mode ?? 'smart';
  const obstacles = nodes.filter((node) => node.id !== source && node.id !== target && node.data?.kind !== 'junction').map(nodeRect);
  const routed = routeForMode(mode, { x: sourceX, y: sourceY }, { x: targetX, y: targetY }, obstacles, data?.customPath);
  const color = signalColor(data?.signal);
  const path = routed.path;
  const points = routed.points;
  const bus = mode === 'bus';
  const beginDotDrag = (event: React.PointerEvent<SVGCircleElement>, dotIndex: number, kind: 'endpoint' | 'vertex' | 'segment') => {
    if (kind === 'endpoint' || !data?.onWireEditChange) return;
    event.preventDefault(); event.stopPropagation();
    const start = points.map((point) => ({ ...point }));
    data.onWireEditStart?.(id);
    const move = (moveEvent: PointerEvent) => {
      const pos = screenToFlowPosition({ x: moveEvent.clientX, y: moveEvent.clientY });
      let next: Point[];
      if (mode === 'curved') next = [start[0], pos, start[start.length - 1]];
      else if (kind === 'vertex') next = start.map((p, i) => i === dotIndex ? pos : p);
      else {
        const replacement = (mode === 'smart' || mode === 'orthogonal' || mode === 'bus') ? shiftedOrthogonalSegment(start[dotIndex], start[dotIndex + 1], pos) : [start[dotIndex], pos, start[dotIndex + 1]];
        next = [...start.slice(0, dotIndex), ...replacement, ...start.slice(dotIndex + 2)];
      }
      const inner = next.slice(1, -1);
      data.onWireEditChange?.(id, inner);
    };
    const up = () => { data.onWireEditEnd?.(id); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
  };
  const dots: Array<{ point: Point; kind: 'endpoint' | 'vertex' | 'segment'; index: number }> = [];
  if (selected) {
    points.forEach((point, index) => dots.push({ point, kind: index === 0 || index === points.length - 1 ? 'endpoint' : 'vertex', index }));
    if (mode !== 'curved') for (let i = 0; i < points.length - 1; i += 1) if (pointDistance(points[i], points[i + 1]) > 34) dots.push({ point: { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }, kind: 'segment', index: i });
  }
  return (
    <>
      {selected && <path d={path} fill="none" stroke="#93c5fd" strokeWidth={bus ? 15 : 11} strokeLinecap="round" opacity={0.45} />}
      <BaseEdge path={path} interactionWidth={24} className={`wire-edge wire-mode-${mode} ${selected ? 'wire-selected' : ''}`} style={{ stroke: color, strokeWidth: bus ? (selected ? 8 : 6) : (selected ? 4 : 3), strokeDasharray: bus ? '12 8' : undefined }} />
      {animated && !bus && <path d={path} fill="none" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.7} strokeDasharray="3 11" className="energy-trace" />}
      {selected && <g className="wire-edit-controls">{dots.map((dot, index) => <circle key={`${dot.kind}-${dot.index}-${index}`} cx={dot.point.x} cy={dot.point.y} r={dot.kind === 'endpoint' ? 4.5 : 5.7} className={`wire-edit-point ${dot.kind === 'endpoint' ? 'endpoint' : 'editable'}`} onPointerDown={(event) => beginDotDrag(event, dot.index, dot.kind)} />)}</g>}
      {data?.showLabel && <g className="edge-label"><rect x={(sourceX + targetX) / 2 - 46} y={(sourceY + targetY) / 2 - 13} width="92" height="26" rx="10" fill="white" /><text x={(sourceX + targetX) / 2} y={(sourceY + targetY) / 2 + 4} textAnchor="middle">{data.netName}</text></g>}
    </>
  );
}

function JunctionNode({ selected }: { selected: boolean }) {
  return (
    <div className={`junction-node ${selected ? 'selected' : ''}`} title="Junction — all sides share one electrical net">
      <Handle type="source" position={Position.Top} id="n" className="junction-handle junction-n" />
      <Handle type="source" position={Position.Right} id="e" className="junction-handle junction-e" />
      <Handle type="source" position={Position.Bottom} id="s" className="junction-handle junction-s" />
      <Handle type="source" position={Position.Left} id="w" className="junction-handle junction-w" />
      <span>•</span>
    </div>
  );
}

function CircuitNode({ id, data, selected }: NodeProps<CircuitNode>) {
  if (data.kind === 'junction') return <JunctionNode selected={selected} />;
  const noConnects = new Set(data.noConnects ?? []);
  const simulation = data.simulation;
  const handles: Array<{ id: string; pos: Position; className: string; label: string }> = [];
  if (data.kind === 'battery') handles.push({ id: 'neg', pos: Position.Left, className: 'pin-left', label: '−' }, { id: 'pos', pos: Position.Right, className: 'pin-right', label: '+' });
  else if (data.kind === 'ground') handles.push({ id: 'gnd', pos: Position.Top, className: 'pin-top', label: 'GND' });
  else if (data.kind === 'led') handles.push({ id: 'in', pos: Position.Left, className: 'pin-left', label: 'A' }, { id: 'out', pos: Position.Right, className: 'pin-right', label: 'K' });
  else handles.push({ id: 'in', pos: Position.Left, className: 'pin-left', label: 'IN' }, { id: 'out', pos: Position.Right, className: 'pin-right', label: 'OUT' });
  return (
    <div className={`circuit-node ${data.kind} ${selected ? 'selected' : ''} ${simulation?.status === 'warning' ? 'sim-warning' : ''} ${simulation?.status === 'error' ? 'sim-error' : ''}`}>
      {handles.map((pin) => <div className={`pin-wrap ${pin.className}`} key={pin.id}>
        <Handle type={pin.id === 'pos' || pin.id === 'out' ? 'source' : 'target'} position={pin.pos} id={pin.id} className={`handle ${noConnects.has(pin.id) ? 'nc-handle' : ''}`} onPointerDown={(event) => { if (!data.onPinPointerDown) return; event.preventDefault(); event.stopPropagation(); data.onPinPointerDown(id, pin.id, event); }} />
        <span className="pin-label">{pin.label}</span>
        {noConnects.has(pin.id) && <span className="nc-marker">× NC</span>}
      </div>)}
      <div className="component-visual"><img src={componentSvg(data.kind)} alt="" draggable={false} /><div className="node-icon-fallback">{iconFor(data.kind)}</div></div>
      <div className="node-copy"><strong>{data.label}</strong><span>{data.description}</span>{simulation && <small className={`sim-chip ${simulation.status}`}>{simulation.state ? simulation.state.toUpperCase() : 'LIVE'} {simulation.currentMa !== undefined ? `· ${formatCurrent(simulation.currentMa)}` : ''}</small>}</div>
    </div>
  );
}

const nodeTypes = { circuit: CircuitNode };
const edgeTypes = { wire: WireEdge };

function iconFor(kind: ComponentKind) {
  switch (kind) {
    case 'battery': return <BatteryCharging size={20} />;
    case 'resistor': return <span className="text-icon">Ω</span>;
    case 'led': return <Activity size={20} />;
    case 'switch': return <span className="text-icon">↗</span>;
    case 'motor': return <Zap size={20} />;
    case 'ground': return <span className="text-icon">⏚</span>;
    case 'junction': return <span className="text-icon">•</span>;
  }
}

function formatCurrent(ma: number) { return ma < 1000 ? `${ma.toFixed(1)} mA` : `${(ma / 1000).toFixed(2)} A`; }
function formatVoltage(v: number) { return `${v.toFixed(2)} V`; }
function formatPower(w: number | undefined) { return w === undefined ? '—' : w < 1 ? `${(w * 1000).toFixed(1)} mW` : `${w.toFixed(2)} W`; }
function wireModeLabel(mode: WireMode) { return mode === 'smart' ? 'Smart auto-route' : mode === 'orthogonal' ? '90° orthogonal' : mode === 'diagonal' ? '45° diagonal' : mode === 'curved' ? 'Curved' : mode === 'bus' ? 'Bus' : 'Edited path'; }

function topology(nodes: CircuitNode[], edges: CircuitEdge[]) {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    let root = parent.get(x)!;
    while (root !== parent.get(root)) root = parent.get(root)!;
    while (x !== root) { const next = parent.get(x)!; parent.set(x, root); x = next; }
    return root;
  };
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra); };
  const endpoint = (nodeId: string, handle: string | null | undefined) => `pin:${nodeId}:${handle ?? ''}`;
  nodes.forEach((node) => {
    if (node.data.kind === 'junction') ['junction', 'n', 'e', 's', 'w'].forEach((pin) => union(endpoint(node.id, 'junction'), endpoint(node.id, pin)));
  });
  edges.forEach((edge) => { if (edge.source && edge.target) union(endpoint(edge.source, edge.sourceHandle), endpoint(edge.target, edge.targetHandle)); });
  const edgeRoot = new Map<string, string>();
  edges.forEach((edge) => { edgeRoot.set(edge.id, find(endpoint(edge.source, edge.sourceHandle))); });
  return { edgeRoot, find };
}

function endpointLabel(nodes: CircuitNode[], edge: CircuitEdge, from: boolean) {
  const node = nodes.find((item) => item.id === (from ? edge.source : edge.target));
  if (!node) return from ? edge.source : edge.target;
  const handle = from ? edge.sourceHandle : edge.targetHandle;
  const pin = handle === 'pos' ? '+' : handle === 'neg' ? '−' : handle === 'gnd' ? 'GND' : handle === 'in' ? (node.data.kind === 'led' ? 'ANODE' : 'IN') : handle === 'out' ? (node.data.kind === 'led' ? 'CATHODE' : 'OUT') : (handle ?? 'PIN').toUpperCase();
  return `${node.data.label} · ${pin}`;
}

function SimulationPanel({ result, onSimulate, loading }: { result: SimulationResult | null; onSimulate: () => void; loading: boolean }) {
  if (!result) return null;
  const led = result.branches.find((b) => b.type === 'led');
  const motor = result.branches.find((b) => b.type === 'motor');
  const resistor = result.branches.find((b) => b.type === 'resistor');
  const switchBranch = result.branches.find((b) => b.type === 'switch');
  return (
    <div className={`simulation-panel ${result.status}`}>
      <div className="sim-panel-head"><div><strong>⚡ Simulation Results</strong><span>{result.status === 'ok' ? 'Circuit operating normally' : result.status === 'warning' ? 'Circuit runs with warnings' : 'Simulation blocked by errors'}</span></div><button className="soft-btn" onClick={onSimulate} disabled={loading}>{loading ? 'Solving…' : 'Rerun'}</button></div>
      <div className="sim-status-row"><span className={result.status === 'error' ? 'error-dot' : result.status === 'warning' ? 'warning-dot' : 'ready-dot'} /> <strong>{result.status === 'ok' ? 'Valid' : result.status === 'warning' ? 'Warning' : 'Invalid'}</strong><span>· {result.summary.netCount} nets · {result.summary.branchCount} components</span></div>
      {result.errors.map((error) => <div key={error} className="sim-message error"><AlertTriangle size={14} />{error}</div>)}
      {result.warnings.map((warning) => <div key={warning} className="sim-message warning"><AlertTriangle size={14} />{warning}</div>)}
      <div className="sim-grid">
        {resistor && <div><span>R1</span><strong>{resistor.resistanceOhms?.toFixed(0)} Ω</strong><small>{formatCurrent(resistor.currentMa)}</small></div>}
        {led && <div><span>LED1</span><strong>{led.state?.toUpperCase() ?? 'OFF'}</strong><small>{formatCurrent(led.currentMa)}</small></div>}
        {switchBranch && <div><span>SW1</span><strong>{switchBranch.closed ? 'CLOSED' : 'OPEN'}</strong><small>{formatCurrent(switchBranch.currentMa)}</small></div>}
        {motor && <div><span>M1</span><strong>{formatCurrent(motor.currentMa)}</strong><small>{formatPower(motor.powerW)}</small></div>}
      </div>
    </div>
  );
}

function ComponentPropertyEditor({ node, onApply }: { node: CircuitNode; onApply: (properties: ComponentProperties) => void }) {
  const [draft, setDraft] = useState<ComponentProperties>({ ...(node.data.properties ?? defaultProperties(node.data.kind)) });
  useEffect(() => setDraft({ ...(node.data.properties ?? defaultProperties(node.data.kind)) }), [node.id, node.data.properties, node.data.kind]);
  if (['ground', 'junction'].includes(node.data.kind)) return null;
  const update = <K extends keyof ComponentProperties>(key: K, value: ComponentProperties[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="property-editor">
      <div className="property-title">Electrical model</div>
      {node.data.kind === 'battery' && <label>Voltage<input type="number" step="0.1" value={draft.voltage ?? 9} onChange={(e) => update('voltage', Number(e.target.value))} /> <small>V</small></label>}
      {node.data.kind === 'resistor' && <label>Resistance<input type="number" step="1" min="0.001" value={draft.resistance ?? 470} onChange={(e) => update('resistance', Number(e.target.value))} /> <small>Ω</small></label>}
      {node.data.kind === 'switch' && <label className="switch-row">Closed<input type="checkbox" checked={draft.closed ?? true} onChange={(e) => update('closed', e.target.checked)} /></label>}
      {node.data.kind === 'led' && <><label>Forward voltage<input type="number" step="0.1" value={draft.forwardVoltage ?? 2} onChange={(e) => update('forwardVoltage', Number(e.target.value))} /> <small>V</small></label><label>Max current<input type="number" step="1" value={(draft.maxCurrent ?? 0.02) * 1000} onChange={(e) => update('maxCurrent', Number(e.target.value) / 1000)} /> <small>mA</small></label></>}
      {node.data.kind === 'motor' && <><label>Resistance<input type="number" step="0.1" min="0.001" value={draft.resistance ?? 30} onChange={(e) => update('resistance', Number(e.target.value))} /> <small>Ω</small></label><label>Max current<input type="number" step="10" value={(draft.maxCurrent ?? 0.35) * 1000} onChange={(e) => update('maxCurrent', Number(e.target.value) / 1000)} /> <small>mA</small></label></>}
      <button className="primary-btn" onClick={() => onApply(draft)}><Check size={15} /> Apply values</button>
    </div>
  );
}

function App() {
  const loadSaved = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { nodes: initialNodes, edges: initialEdges };
      const parsed = JSON.parse(raw) as { nodes?: CircuitNode[]; edges?: CircuitEdge[] };
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return { nodes: initialNodes, edges: initialEdges };
      return { nodes: parsed.nodes, edges: parsed.edges };
    } catch { return { nodes: initialNodes, edges: initialEdges }; }
  }, []);
  const saved = useMemo(loadSaved, [loadSaved]);
  const [nodes, setNodes] = useState<CircuitNode[]>(saved.nodes);
  const [edges, setEdges] = useState<CircuitEdge[]>(saved.edges);
  const [wireMode, setWireMode] = useState<WireMode>('smart');
  const [toolMode, setToolMode] = useState<'select' | 'wire' | 'junction' | 'label' | 'nc'>('wire');
  const [dark, setDark] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [simulate, setSimulate] = useState(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<'unknown' | 'online' | 'offline'>('unknown');
  const [highlightNet, setHighlightNet] = useState(true);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [checkState, setCheckState] = useState<{ errors: number; warnings: number } | null>(null);
  const dragSnapshot = useRef<Snapshot | null>(null);
  const wireEditSnapshot = useRef<Snapshot | null>(null);
  const wireEditChanged = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const renameInput = useRef<HTMLInputElement | null>(null);
  const simulationAbort = useRef<AbortController | null>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();

  const activeNode = nodes.find((node) => node.id === selectedNode) ?? null;
  const activeEdge = edges.find((edge) => edge.id === selectedEdge) ?? null;
  const uiTopology = useMemo(() => topology(nodes, edges), [nodes, edges]);
  const activeEdgeRoot = activeEdge ? uiTopology.edgeRoot.get(activeEdge.id) : null;
  const netCount = new Set(Array.from(uiTopology.edgeRoot.values())).size;
  const simById = useMemo(() => {
    const map = new Map<string, SimulationState>();
    simulationResult?.branches.forEach((branch) => map.set(branch.id, { status: branch.status === 'warning' ? 'warning' : simulationResult.status === 'error' ? 'error' : 'ok', currentMa: branch.currentMa, voltageV: branch.voltageV, powerW: branch.powerW, state: branch.state }));
    return map;
  }, [simulationResult]);
  const filteredPalette = useMemo(() => palette.filter((item) => item.label.toLowerCase().includes(search.toLowerCase())), [search]);

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(null), 2200); }, []);
  const commit = useCallback((nextNodes: CircuitNode[], nextEdges: CircuitEdge[], message?: string) => {
    setPast((current) => [...current.slice(-39), cloneSnapshot(nodes, edges)]);
    setFuture([]); setNodes(nextNodes); setEdges(nextEdges); if (message) notify(message);
  }, [edges, nodes, notify]);

  const runSimulation = useCallback(async (nextNodes: CircuitNode[], nextEdges: CircuitEdge[]) => {
    simulationAbort.current?.abort();
    const controller = new AbortController();
    simulationAbort.current = controller;
    setSimulationLoading(true); setBackendError(null);
    try {
      try {
        const health = await fetch(HEALTH_URL, { cache: 'no-store', signal: controller.signal });
        if (!health.ok) throw new Error(`Backend health check returned HTTP ${health.status}`);
        setBackendStatus('online');
      } catch (healthError) {
        if (healthError instanceof DOMException && healthError.name === 'AbortError') return;
        setBackendStatus('offline');
        throw new Error(`KLS simulation backend is offline at 127.0.0.1:18080 (${healthError instanceof Error ? healthError.message : 'health check failed'})`);
      }
      const payload = JSON.stringify({ nodes: nextNodes, edges: nextEdges, options: { mode: 'dc', version: 'v1' } });
      const candidates = [`${API_URL}/simulate`, `${LEGACY_API_URL}/simulate/dc`];
      let lastMessage = 'Simulation backend unavailable';
      for (const url of candidates) {
        try {
          const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: controller.signal });
          if (response.ok) {
            const result = await response.json() as SimulationResult;
            if (simulationAbort.current === controller) { setBackendStatus('online'); setSimulationResult(result); setBackendError(null); }
            return;
          }
          const contentType = response.headers.get('content-type') || '';
          let detail = '';
          if (contentType.includes('application/json')) {
            try { const body = await response.json() as { detail?: string; message?: string }; detail = body.detail || body.message || ''; } catch { /* ignore malformed error body */ }
          } else {
            try { detail = (await response.text()).slice(0, 180); } catch { /* ignore */ }
          }
          lastMessage = `Simulation API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          lastMessage = error instanceof Error ? error.message : lastMessage;
        }
      }
      throw new Error(lastMessage);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (simulationAbort.current !== controller) return;
      const message = error instanceof Error ? error.message : 'Simulation backend unavailable';
      setBackendError(message);
      setSimulationResult(null);
    } finally {
      if (simulationAbort.current === controller) { simulationAbort.current = null; setSimulationLoading(false); }
    }
  }, []);

  const toggleSimulation = useCallback(() => {
    if (simulate) { simulationAbort.current?.abort(); setSimulationLoading(false); setSimulate(false); setSimulationResult(null); notify('Simulation stopped'); return; }
    setSimulate(true); notify('Simulation started'); void runSimulation(nodes, edges);
  }, [edges, nodes, notify, runSimulation, simulate]);

  useEffect(() => {
    if (!simulate) { simulationAbort.current?.abort(); return; }
    const timer = window.setTimeout(() => { void runSimulation(nodes, edges); }, 280);
    return () => window.clearTimeout(timer);
  }, [edges, nodes, simulate, runSimulation]);

  useEffect(() => () => { simulationAbort.current?.abort(); }, []);

  useEffect(() => { const timer = window.setTimeout(() => safeStorageSet(STORAGE_KEY, JSON.stringify({ version: 6, nodes, edges })), 400); return () => window.clearTimeout(timer); }, [edges, nodes]);

  const onNodesChange = useCallback((changes: NodeChange<CircuitNode>[]) => setNodes((current) => applyNodeChanges(changes, current) as CircuitNode[]), []);
  const onEdgesChange = useCallback((changes: EdgeChange<CircuitEdge>[]) => {
    if (changes.some((change) => change.type === 'remove')) {
      const next = applyEdgeChanges(changes, edges) as CircuitEdge[];
      commit(nodes, next, 'Wire deleted'); setSelectedEdge(null); return;
    }
    setEdges((current) => applyEdgeChanges(changes, current) as CircuitEdge[]);
  }, [commit, edges, nodes]);

  const componentCount = useCallback((prefix: string) => nodes.filter((node) => node.data.kind !== 'junction' && node.data.label.startsWith(prefix)).length + 1, [nodes]);
  const addComponent = useCallback((kind: ComponentKind, screen?: { x: number; y: number }) => {
    if (kind === 'junction') return;
    const meta = palette.find((item) => item.kind === kind); if (!meta) return;
    const n = componentCount(meta.prefix); const label = kind === 'ground' ? (n === 1 ? 'GND' : `GND${n}`) : `${meta.prefix}${n}`;
    const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const position = screen ? screenToFlowPosition(screen) : screenToFlowPosition({ x: 520 + (nodes.length % 3) * 220, y: 300 + Math.floor(nodes.length / 3) * 130 });
    const node: CircuitNode = { id, type: 'circuit', position, data: { kind, label, description: meta.desc, status: 'New component', properties: defaultProperties(kind) } };
    commit([...nodes, node], edges, `${meta.label} added`); setSelectedNode(id); setSelectedEdge(null);
  }, [commit, componentCount, edges, nodes, screenToFlowPosition]);

  const onDrop = useCallback((event: React.DragEvent) => { event.preventDefault(); const kind = event.dataTransfer.getData('application/kls-kind') as ComponentKind; if (kind) addComponent(kind, { x: event.clientX, y: event.clientY }); }, [addComponent]);
  const incidentNet = useCallback((nodeId: string) => edges.find((edge) => edge.source === nodeId || edge.target === nodeId)?.data?.netName, [edges]);

  const handlePinJunction = useCallback((nodeId: string, handleId: string, event: React.PointerEvent<HTMLDivElement>) => {
    if (toolMode !== 'junction') return;
    event.preventDefault(); event.stopPropagation();
    const node = nodes.find((item) => item.id === nodeId); if (!node) return;
    const existing = edges.find((edge) => ((edge.source === nodeId && edge.sourceHandle === handleId) || (edge.target === nodeId && edge.targetHandle === handleId)) && (nodes.find((item) => item.id === (edge.source === nodeId ? edge.target : edge.source))?.data.kind === 'junction'));
    if (existing) { const junctionId = existing.source === nodeId ? existing.target : existing.source; setSelectedNode(junctionId); setSelectedEdge(null); notify('Junction already anchored to this terminal'); return; }
    const pin = getNodePinPoint(node, handleId); const side = handleId === 'pos' || handleId === 'out' ? 'w' : handleId === 'gnd' ? 's' : 'e';
    const junctionId = `junction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const junction: CircuitNode = { id: junctionId, type: 'circuit', position: { x: pin.x - 7, y: pin.y - 7 }, data: { kind: 'junction', label: 'J', description: 'Electrical junction', status: 'Terminal branch', netName: incidentNet(nodeId) ?? `NET_${edges.length + 1}` } };
    const anchor: CircuitEdge = { id: `wire-anchor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, source: nodeId, sourceHandle: handleId, target: junctionId, targetHandle: side, type: 'wire', data: { netName: junction.data.netName, signal: junction.data.netName === 'GND' ? 'Ground' : 'Signal', mode: 'smart' } };
    commit([...nodes, junction], [...edges, anchor], 'Junction anchored to terminal'); setSelectedNode(junctionId); setSelectedEdge(null); setToolMode('wire');
  }, [commit, edges, incidentNet, nodes, notify, toolMode]);

  const onConnect = useCallback((connection: Connection) => {
    if (toolMode !== 'wire') { notify('Switch to Wire mode before making a connection'); return; }
    if (!connection.source || !connection.target || connection.source === connection.target) { notify('A wire needs two different pins'); return; }
    const sourceNode = nodes.find((node) => node.id === connection.source), targetNode = nodes.find((node) => node.id === connection.target);
    const inherited = (sourceNode?.data.kind === 'junction' ? sourceNode.data.netName : undefined) ?? (targetNode?.data.kind === 'junction' ? targetNode.data.netName : undefined) ?? ((sourceNode?.data.kind === 'ground' || targetNode?.data.kind === 'ground') ? 'GND' : undefined) ?? ((connection.sourceHandle === 'pos' || connection.targetHandle === 'pos') ? 'VCC' : undefined);
    const netName = inherited ?? `NET_${edges.length + 1}`; const signal: SignalType = wireMode === 'bus' ? 'Bus' : netName === 'GND' ? 'Ground' : netName === 'VCC' ? 'Power' : 'Signal';
    const sourceHasNc = sourceNode?.data.noConnects?.includes(connection.sourceHandle ?? '') ?? false;
    const targetHasNc = targetNode?.data.noConnects?.includes(connection.targetHandle ?? '') ?? false;
    if (sourceHasNc || targetHasNc) { notify('Cannot connect to a terminal marked NC'); return; }
    const duplicate = edges.some((edge) =>
      (edge.source === connection.source && edge.sourceHandle === connection.sourceHandle && edge.target === connection.target && edge.targetHandle === connection.targetHandle) ||
      (edge.source === connection.target && edge.sourceHandle === connection.targetHandle && edge.target === connection.source && edge.targetHandle === connection.sourceHandle)
    );
    if (duplicate) { notify('That pin-to-pin connection already exists'); return; }
    const edge: CircuitEdge = { id: `wire-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, source: connection.source, sourceHandle: connection.sourceHandle ?? undefined, target: connection.target, targetHandle: connection.targetHandle ?? undefined, type: 'wire', data: { netName, signal, mode: wireMode, width: wireMode === 'bus' ? 4 : 2 } };
    commit(nodes, [...edges, edge], `${wireModeLabel(wireMode)} wire connected`); setSelectedEdge(edge.id); setSelectedNode(null);
  }, [commit, edges, nodes, notify, toolMode, wireMode]);

  const chooseWireMode = useCallback((mode: WireMode) => {
    setWireMode(mode);
    if (!activeEdge) { notify(`${wireModeLabel(mode)} selected for new wires`); return; }
    const nextEdges = edges.map((edge) => edge.id === activeEdge.id ? { ...edge, data: { ...edge.data, mode, customPath: undefined, signal: mode === 'bus' ? 'Bus' : edge.data?.signal === 'Bus' ? 'Signal' : edge.data?.signal } } : edge);
    commit(nodes, nextEdges, `Selected wire changed to ${wireModeLabel(mode)}`);
  }, [activeEdge, commit, edges, nodes, notify]);

  const toggleNoConnect = useCallback((nodeId: string, handleId: string) => {
    const node = nodes.find((item) => item.id === nodeId); if (!node) return;
    const current = new Set(node.data.noConnects ?? []); if (current.has(handleId)) current.delete(handleId); else current.add(handleId);
    commit(nodes.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, noConnects: [...current] } } : item), edges, `${current.has(handleId) ? 'No-connect added' : 'No-connect removed'} on ${node.data.label}`);
  }, [commit, edges, nodes]);

  const deleteSelected = useCallback(() => {
    if (selectedEdge) { commit(nodes, edges.filter((edge) => edge.id !== selectedEdge), 'Wire deleted'); setSelectedEdge(null); return; }
    if (!selectedNode) return;
    commit(nodes.filter((node) => node.id !== selectedNode), edges.filter((edge) => edge.source !== selectedNode && edge.target !== selectedNode), 'Component deleted'); setSelectedNode(null); setSelectedEdge(null);
  }, [commit, edges, nodes, selectedEdge, selectedNode]);

  const splitEdgeWithJunction = useCallback((edge: CircuitEdge, clientX: number, clientY: number) => {
    const position = screenToFlowPosition({ x: clientX, y: clientY }); const s = getNodePinPoint(nodes.find((n) => n.id === edge.source), edge.sourceHandle); const t = getNodePinPoint(nodes.find((n) => n.id === edge.target), edge.targetHandle);
    const junctionId = `junction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const junction: CircuitNode = { id: junctionId, type: 'circuit', position: { x: position.x - 7, y: position.y - 7 }, data: { kind: 'junction', label: 'J', description: 'Electrical junction', status: 'Shared net', netName: edge.data?.netName } };
    const fromSide = nearestJunctionSide(s, position), toSide = nearestJunctionSide(t, position);
    const e1: CircuitEdge = { id: `${edge.id}-a`, source: edge.source, sourceHandle: edge.sourceHandle, target: junctionId, targetHandle: fromSide, type: 'wire', data: { ...edge.data, customPath: undefined } };
    const e2: CircuitEdge = { id: `${edge.id}-b`, source: junctionId, sourceHandle: toSide, target: edge.target, targetHandle: edge.targetHandle, type: 'wire', data: { ...edge.data, customPath: undefined } };
    commit([...nodes, junction], edges.filter((item) => item.id !== edge.id).concat(e1, e2), `Junction inserted on ${edge.data?.netName ?? 'NET'}`); setSelectedNode(junctionId); setSelectedEdge(null); setToolMode('wire');
  }, [commit, edges, nodes, screenToFlowPosition]);

  const onEdgeClick = useCallback((event: React.MouseEvent, edge: CircuitEdge) => {
    event.stopPropagation();
    if (toolMode === 'junction') { splitEdgeWithJunction(edge, event.clientX, event.clientY); return; }
    if (toolMode === 'label') { setSelectedEdge(edge.id); setSelectedNode(null); setRenameValue(edge.data?.netName ?? 'NET'); setRenameOpen(true); return; }
    setSelectedEdge(edge.id); setSelectedNode(null);
  }, [splitEdgeWithJunction, toolMode]);

  const onNodeClick = useCallback((event: React.MouseEvent, node: CircuitNode) => {
    event.stopPropagation();
    if (toolMode === 'nc') { const pin = node.data.kind === 'battery' ? 'neg' : node.data.kind === 'ground' ? 'gnd' : 'in'; toggleNoConnect(node.id, pin); return; }
    if (toolMode === 'label') { notify('Net Label mode applies to a wire'); return; }
    setSelectedNode(node.id); setSelectedEdge(null);
  }, [notify, toggleNoConnect, toolMode]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    if (toolMode === 'junction') {
      const p = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `junction-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      commit([...nodes, { id, type: 'circuit', position: { x: p.x - 7, y: p.y - 7 }, data: { kind: 'junction', label: 'J', description: 'Electrical junction', status: 'Shared net' } }], edges, 'Junction placed'); setSelectedNode(id); return;
    }
    setSelectedNode(null); setSelectedEdge(null);
  }, [commit, edges, nodes, screenToFlowPosition, toolMode]);

  const setModeTool = useCallback((mode: 'select' | 'wire' | 'junction' | 'label' | 'nc') => { setToolMode(mode); if (mode === 'junction') notify('Junction: click a wire to split it, or click a terminal to branch'); if (mode === 'label') notify('Net Label: click a wire'); if (mode === 'nc') notify('NC: click a component to mark an unused input'); }, [notify]);

  const onWireEditStart = useCallback((edgeId: string) => { wireEditSnapshot.current = cloneSnapshot(nodes, edges); wireEditChanged.current = false; setSelectedEdge(edgeId); setSelectedNode(null); }, [edges, nodes]);
  const onWireEditChange = useCallback((edgeId: string, nextCustomPath: Point[]) => { wireEditChanged.current = true; setEdges((current) => current.map((edge) => edge.id === edgeId ? { ...edge, data: { ...edge.data, customPath: nextCustomPath, mode: edge.data?.mode === 'curved' ? 'curved' : 'custom' } } : edge)); }, []);
  const onWireEditEnd = useCallback((edgeId: string) => { const snapshot = wireEditSnapshot.current; if (snapshot && wireEditChanged.current) { setPast((current) => [...current.slice(-39), snapshot]); setFuture([]); notify('Wire reshaped'); } wireEditSnapshot.current = null; wireEditChanged.current = false; setSelectedEdge(edgeId); }, [notify]);

  const renameNet = useCallback(() => {
    if (!activeEdge || !activeEdgeRoot) return;
    const value = renameValue.trim() || activeEdge.data?.netName || 'NET';
    const nextEdges = edges.map((edge) => uiTopology.edgeRoot.get(edge.id) === activeEdgeRoot ? { ...edge, data: { ...edge.data, netName: value, showLabel: true } } : edge);
    commit(nodes, nextEdges, `Net renamed to ${value}`); setRenameOpen(false); setRenameValue('');
  }, [activeEdge, activeEdgeRoot, commit, edges, nodes, renameValue, uiTopology]);

  const updateComponentProperties = useCallback((nodeId: string, properties: ComponentProperties) => {
    const node = nodes.find((item) => item.id === nodeId); if (!node) return;
    const description = node.data.kind === 'battery' ? `${properties.voltage ?? 9} V DC source` : node.data.kind === 'resistor' ? `${properties.resistance ?? 470} Ω current limit` : node.data.kind === 'motor' ? `${properties.resistance ?? 30} Ω DC actuator` : node.data.kind === 'led' ? `${properties.forwardVoltage ?? 2} V red indicator` : node.data.description;
    const status = node.data.kind === 'switch' ? ((properties.closed ?? true) ? 'Closed' : 'Open') : node.data.status;
    commit(nodes.map((item) => item.id === nodeId ? { ...item, data: { ...item.data, properties, description, status } } : item), edges, `${node.data.label} values updated`);
  }, [commit, edges, nodes]);

  const saveDesign = useCallback(() => { safeStorageSet(STORAGE_KEY, JSON.stringify({ version: 8, nodes, edges })); notify('Design saved locally'); }, [edges, nodes, notify]);
  const exportDesign = useCallback(() => { const blob = new Blob([JSON.stringify({ version: 8, nodes, edges }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'kls-smart-wiring-simulation-v8.json'; link.click(); URL.revokeObjectURL(url); notify('Design exported'); }, [edges, nodes, notify]);
  const importDesign = useCallback((event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const parsed = JSON.parse(String(reader.result)) as { nodes: CircuitNode[]; edges: CircuitEdge[] }; if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('invalid'); commit(parsed.nodes, parsed.edges, 'Design imported'); setSelectedNode(null); setSelectedEdge(null); window.setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 0); } catch { notify('Import failed — choose a KLS JSON design'); } }; reader.readAsText(file); event.target.value = ''; }, [commit, fitView, notify]);
  const undo = useCallback(() => { const previous = past[past.length - 1]; if (!previous) return; setFuture((current) => [...current, cloneSnapshot(nodes, edges)]); setPast((current) => current.slice(0, -1)); setNodes(previous.nodes); setEdges(previous.edges); setSelectedNode(null); setSelectedEdge(null); notify('Undo'); }, [edges, nodes, notify, past]);
  const redo = useCallback(() => { const next = future[future.length - 1]; if (!next) return; setPast((current) => [...current, cloneSnapshot(nodes, edges)]); setFuture((current) => current.slice(0, -1)); setNodes(next.nodes); setEdges(next.edges); setSelectedNode(null); setSelectedEdge(null); notify('Redo'); }, [edges, future, nodes, notify]);

  const validateDesign = useCallback(async () => {
    const localErrors: string[] = [], localWarnings: string[] = [], ids = new Set(nodes.map((node) => node.id));
    edges.forEach((edge) => { if (!ids.has(edge.source) || !ids.has(edge.target)) localErrors.push(`${edge.id}: missing endpoint`); if (edge.source === edge.target) localErrors.push(`${edge.id}: self-connection`); });
    try {
      const response = await fetch(`${API_URL}/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes, edges }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const server = await response.json() as { errors?: string[]; warnings?: string[] };
      localErrors.push(...(server.errors ?? [])); localWarnings.push(...(server.warnings ?? []));
      setCheckState({ errors: localErrors.length, warnings: localWarnings.length }); notify(localErrors.length ? `Check found ${localErrors.length} error(s)` : `✓ Design validated — ${localWarnings.length} warning(s)`);
    } catch (error) {
      setCheckState({ errors: localErrors.length, warnings: localWarnings.length }); setBackendError(error instanceof Error ? `Validation API unavailable: ${error.message}` : 'Validation API unavailable'); notify('Local check completed; backend validation unavailable');
    }
  }, [edges, nodes, notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (renameOpen) { if (event.key === 'Escape') setRenameOpen(false); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveDesign(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
      if (event.key === 'Escape') setModeTool('select');
      if (event.key === '1') setModeTool('wire'); if (event.key === '2') chooseWireMode('smart'); if (event.key === '3') chooseWireMode('orthogonal'); if (event.key === '4') chooseWireMode('diagonal'); if (event.key === '5') chooseWireMode('curved');
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [chooseWireMode, deleteSelected, redo, renameOpen, saveDesign, setModeTool, undo]);

  const wireButtons: Array<{ id: WireMode; label: string; hint: string }> = [
    { id: 'smart', label: 'Smart', hint: 'Obstacle-aware' }, { id: 'orthogonal', label: '90°', hint: 'Clean corners' }, { id: 'diagonal', label: '45°', hint: 'Diagonal' }, { id: 'curved', label: 'Curved', hint: 'Bezier' }, { id: 'bus', label: 'Bus', hint: 'Multi-line' },
  ];

  return (
    <div className={`app-shell ${dark ? 'dark' : ''}`}>
      <header className="topbar">
        <div className="brand-block"><div className="brand-mark"><CircuitBoard size={20} /></div><div><div className="brand-title">KLS Studio</div><div className="brand-subtitle">Design · Simulate · Learn</div></div></div>
        <div className="global-search"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search components..." /><kbd>Ctrl K</kbd></div>
        <div className="top-actions"><button className="icon-btn" onClick={() => setDark((value) => !value)} title="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button><button className={`simulate-btn ${simulate ? 'active' : ''}`} onClick={toggleSimulation}><Zap size={17} /> {simulate ? 'STOP' : 'SIMULATE'}</button><button className="icon-btn" onClick={saveDesign}><Save size={18} /></button><button className="icon-btn" onClick={undo} disabled={!past.length}><Undo2 size={18} /></button><button className="icon-btn" onClick={redo} disabled={!future.length}><Redo2 size={18} /></button><div className="user-chip"><div className="avatar">RK</div><div><strong>Ravi Kumar</strong><span>STUDENT</span></div></div></div>
      </header>

      <div className="workspace">
        <aside className="rail"><button className="rail-btn active"><CircuitBoard size={20} /></button><button className="rail-btn"><BatteryCharging size={20} /></button><button className="rail-btn"><Link2 size={20} /></button><button className="rail-btn"><Settings size={20} /></button><div className="rail-spacer" /><button className="rail-btn"><CircleHelp size={20} /></button></aside>
        <aside className="component-panel"><div className="panel-header"><div><h2>Components</h2><span>6 essentials for simulation</span></div><button className="mini-btn" onClick={() => setSearch('')}><X size={16} /></button></div><div className="component-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search components..." /></div><div className="filter-row"><button className="filter active">All</button><button className="filter">Popular</button><button className="filter">Recent</button></div><div className="component-grid">{filteredPalette.map((item) => <button key={item.kind} className="component-card" draggable onDragStart={(event) => event.dataTransfer.setData('application/kls-kind', item.kind)} onClick={() => addComponent(item.kind)}><div className={`component-thumb ${item.tone}`}><img src={componentSvg(item.kind)} alt="" /></div><strong>{item.label}</strong><span>{item.desc}</span></button>)}</div><div className="drag-tip"><Plus size={15} /> Click to add · drag to place</div></aside>

        <main className="canvas-wrap">
          <div className="wire-toolbar"><button className={`tool-btn ${toolMode === 'wire' ? 'active' : ''}`} onClick={() => setModeTool(toolMode === 'wire' ? 'select' : 'wire')}><Wand2 size={16} /> Wire</button><span className="divider" /><div className="mode-group">{wireButtons.map((button) => <button key={button.id} className={`mode-btn ${wireMode === button.id ? 'selected' : ''}`} onClick={() => chooseWireMode(button.id)} title={button.hint}>{button.label}</button>)}</div><div className="toolbar-spacer" /><button className={`mode-btn ${toolMode === 'junction' ? 'selected' : ''}`} onClick={() => setModeTool(toolMode === 'junction' ? 'select' : 'junction')}><GitBranch size={16} /> Junction</button><button className={`mode-btn ${toolMode === 'label' ? 'selected' : ''}`} onClick={() => setModeTool(toolMode === 'label' ? 'select' : 'label')}><Tag size={16} /> Net Label</button><button className={`mode-btn ${toolMode === 'nc' ? 'selected' : ''}`} onClick={() => setModeTool(toolMode === 'nc' ? 'select' : 'nc')}><CircleSlash2 size={16} /> NC</button><button className="mode-btn" onClick={validateDesign}><ShieldCheck size={16} /> Check</button></div>
          <div className="canvas-header"><div className="breadcrumb"><span>Project</span><span>/</span><strong>Smart Wiring + DC Simulation</strong><span className={backendStatus === 'online' ? 'status-dot' : backendStatus === 'offline' ? 'status-dot offline' : 'status-dot'} /><small>{simulate ? (backendStatus === 'online' ? 'Live simulation · backend online' : backendStatus === 'offline' ? 'Simulation backend offline' : 'Live simulation') : toolMode === 'wire' ? 'Wire tool active' : `${toolMode[0].toUpperCase()}${toolMode.slice(1)} mode`}</small></div><div className="canvas-actions"><button className="soft-btn" onClick={exportDesign}><Download size={15} /> Export</button><button className="soft-btn" onClick={() => fileInput.current?.click()}><Upload size={15} /> Import</button><button className="soft-btn autosave"><HardDrive size={15} /> Autosave ON</button><input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={importDesign} /></div></div>
          <div className="flow-canvas" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <ReactFlow
              nodes={nodes.map((node) => ({ ...node, data: { ...node.data, simulation: simById.get(node.id), onPinPointerDown: toolMode === 'junction' && node.data.kind !== 'junction' ? handlePinJunction : undefined }, selected: node.id === selectedNode }))}
              edges={edges.map((edge) => ({ ...edge, selected: edge.id === selectedEdge, animated: simulate && Boolean(simulationResult?.ok), className: activeEdge && uiTopology.edgeRoot.get(edge.id) === activeEdgeRoot && highlightNet ? 'highlight-net' : '', data: { ...edge.data, onWireEditStart, onWireEditChange, onWireEditEnd } }))}
              nodeTypes={nodeTypes} edgeTypes={edgeTypes}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={onNodeClick} onEdgeClick={onEdgeClick}
              onEdgeDoubleClick={(event, edge) => { if (toolMode === 'junction') return; const sourceNode = nodes.find((node) => node.id === edge.source), targetNode = nodes.find((node) => node.id === edge.target); if (!sourceNode || !targetNode) return; const clicked = screenToFlowPosition({ x: event.clientX, y: event.clientY }); const routed = routeForMode(edge.data?.mode ?? 'smart', getNodePinPoint(sourceNode, edge.sourceHandle), getNodePinPoint(targetNode, edge.targetHandle), nodes.filter((n) => n.id !== edge.source && n.id !== edge.target && n.data.kind !== 'junction').map(nodeRect), edge.data?.customPath); const path = edge.data?.mode === 'curved' ? [clicked] : insertBend(routed.points, clicked).slice(1, -1); onWireEditStart(edge.id); onWireEditChange(edge.id, path); onWireEditEnd(edge.id); }}
              onPaneClick={onPaneClick}
              onNodeDragStart={() => { dragSnapshot.current = cloneSnapshot(nodes, edges); }}
              onNodeDragStop={() => { if (dragSnapshot.current) { setPast((current) => [...current.slice(-39), dragSnapshot.current!]); setFuture([]); dragSnapshot.current = null; } }}
              fitView snapToGrid snapGrid={[20, 20]} connectionMode="loose" defaultEdgeOptions={{ type: 'wire' }} connectionLineStyle={{ stroke: '#0ea5e9', strokeWidth: 3 }} panOnScroll zoomOnPinch zoomOnDoubleClick={false} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
            >
              <Background gap={20} size={1} color={dark ? '#243448' : '#dbe5ef'} /><Controls position="bottom-center" showInteractive={false} /><MiniMap position="bottom-right" nodeColor={(node) => node.data?.kind === 'junction' ? '#f59e0b' : '#b8c8d8'} maskColor={dark ? '#09111ecc' : '#eef4f9dd'} />
            </ReactFlow>
            <div className="smart-badge"><Wand2 size={15} /><b>{wireModeLabel(wireMode)}</b><span>routing</span><i>•</i><span>{wireMode === 'smart' ? 'obstacle-aware' : wireButtons.find((item) => item.id === wireMode)?.hint}</span><i>•</i><span>snap to pin</span></div>
            <div className="canvas-hint"><Sparkles size={16} /><div><strong>Wiring Copilot</strong><span>Click a wire for Tinkercad-style edit dots. Drag a dot to reshape, double-click to add a bend, or use Junction mode to branch at a terminal.</span></div></div>
            {simulate && simulationResult && <SimulationPanel result={simulationResult} onSimulate={() => void runSimulation(nodes, edges)} loading={simulationLoading} />}
            {backendError && <div className="backend-error"><AlertTriangle size={16} /><div><strong>Simulation backend unavailable</strong><span>{backendError}</span></div><button className="mini-btn" onClick={() => { setBackendError(null); void runSimulation(nodes, edges); }}><Zap size={14} /></button></div>}
            <div className="selection-tip"><MousePointer2 size={14} /> {toolMode === 'junction' ? 'Click a wire to split · click a terminal to anchor' : toolMode === 'label' ? 'Click a wire to label its net' : selectedEdge ? 'Drag dots to reshape · double-click to add a bend' : 'Click a wire to inspect it and reveal edit dots'}</div>
            {checkState && <div className={`check-badge ${checkState.errors ? 'has-errors' : ''}`}><ShieldCheck size={14} /> {checkState.errors ? `${checkState.errors} errors` : 'No errors'} · {checkState.warnings} warnings</div>}
          </div>
          <div className="statusbar"><div className="status-left"><span className="ready-dot" /> Ready <span className="separator">|</span> {netCount} nets <span className="separator">|</span> {simulate ? `Simulation: ${simulationResult?.status ?? 'starting'}` : 'Design mode'}</div><div className="status-center">Tool: <strong>{toolMode === 'wire' ? wireModeLabel(wireMode) : `${toolMode[0].toUpperCase()}${toolMode.slice(1)}`}</strong></div><div className="status-right"><button onClick={undo}><Undo2 size={14} /> History</button><button onClick={exportDesign}><FileJson size={14} /> Export</button></div></div>
        </main>

        {rightPanelOpen ? <aside className="inspector-panel"><div className="inspector-header"><div><h3>{simulate && simulationResult ? 'Simulation & Inspector' : activeEdge ? 'Wire Inspector' : activeNode ? activeNode.data.kind === 'junction' ? 'Junction Inspector' : 'Component Inspector' : 'Wiring Copilot'}</h3><span>{simulate && simulationResult ? 'Live electrical results' : activeEdge ? 'Electrical connection' : activeNode ? 'Component properties' : 'Live workspace guidance'}</span></div><button className="mini-btn" onClick={() => setRightPanelOpen(false)}><X size={16} /></button></div>
          {simulate && simulationResult && <div className="inspector-simulation"><div className="sim-summary-pill"><span className={simulationResult.status === 'error' ? 'error-dot' : simulationResult.status === 'warning' ? 'warning-dot' : 'ready-dot'} /> <strong>{simulationResult.status === 'ok' ? 'Simulation valid' : simulationResult.status === 'warning' ? 'Simulation warning' : 'Simulation blocked'}</strong><small>{simulationResult.summary.totalCurrentMa ? `Source ${formatCurrent(simulationResult.summary.totalCurrentMa)}` : 'Check the messages below'}</small></div>{simulationResult.branches.map((branch) => <div key={branch.id} className="sim-row"><div><strong>{branch.label}</strong><span>{branch.type}</span></div><div><strong>{formatCurrent(branch.currentMa)}</strong><span>{formatVoltage(branch.voltageV)}</span></div><div><strong>{branch.state ? branch.state.toUpperCase() : formatPower(branch.powerW)}</strong><span>{branch.status}</span></div></div>)}{simulationResult.warnings.concat(simulationResult.errors).slice(0, 3).map((message) => <div className="sim-message compact" key={message}><AlertTriangle size={14} />{message}</div>)}</div>}
          {activeEdge ? <div className="inspector-content"><label>Net Name</label><div className="field"><input value={activeEdge.data?.netName ?? ''} readOnly /><button onClick={() => { setRenameValue(activeEdge.data?.netName ?? 'NET'); setRenameOpen(true); }}><Settings size={14} /></button></div><div className="info-grid"><div><span>From</span><strong>{endpointLabel(nodes, activeEdge, true)}</strong></div><div><span>To</span><strong>{endpointLabel(nodes, activeEdge, false)}</strong></div><div><span>Mode</span><strong>{wireModeLabel(activeEdge.data?.mode ?? 'smart')}</strong></div><div><span>Status</span><strong className="connected">● Connected</strong></div></div><button className={`full-btn highlight ${highlightNet ? 'active' : ''}`} onClick={() => setHighlightNet((value) => !value)}><Sparkles size={15} /> {highlightNet ? 'Net highlighted' : 'Highlight net'}</button><button className="full-btn" onClick={() => { setRenameValue(activeEdge.data?.netName ?? 'NET'); setRenameOpen(true); }}><Tag size={15} /> Rename / label net</button><button className="danger-btn" onClick={deleteSelected}><Trash2 size={15} /> Delete wire</button></div> : activeNode ? <div className="inspector-content"><div className={`component-summary ${activeNode.data.kind}`}><div className="big-component-icon">{iconFor(activeNode.data.kind)}</div><div><strong>{activeNode.data.label}</strong><span>{activeNode.data.description}</span></div></div><div className="info-grid"><div><span>Type</span><strong>{activeNode.data.kind}</strong></div><div><span>Status</span><strong>{activeNode.data.status ?? 'Ready'}</strong></div><div><span>Connections</span><strong>{edges.filter((edge) => edge.source === activeNode.id || edge.target === activeNode.id).length}</strong></div><div><span>NC markers</span><strong>{activeNode.data.noConnects?.length ?? 0}</strong></div></div><ComponentPropertyEditor node={activeNode} onApply={(properties) => updateComponentProperties(activeNode.id, properties)} />{activeNode.data.kind !== 'junction' && <button className="full-btn" onClick={() => toggleNoConnect(activeNode.id, activeNode.data.kind === 'battery' ? 'neg' : activeNode.data.kind === 'ground' ? 'gnd' : 'in')}><CircleSlash2 size={15} /> Toggle NC marker</button>}<button className="danger-btn" onClick={deleteSelected}><Trash2 size={15} /> Delete component</button></div> : <div className="copilot-content"><div className="copilot-hero"><div className="copilot-orb"><Sparkles size={21} /></div><div><strong>Wiring Copilot</strong><span>Electrical intent, not just geometry.</span></div></div><div className="guide-step"><b>01</b><div><strong>Connect</strong><span>Drag pin → pin. Smart mode routes around components.</span></div></div><div className="guide-step"><b>02</b><div><strong>Edit</strong><span>Click a wire for dots, then drag to reshape.</span></div></div><div className="guide-step"><b>03</b><div><strong>Branch</strong><span>Junctions create a shared electrical node.</span></div></div><div className="guide-step"><b>04</b><div><strong>Simulate</strong><span>Run the real Python DC solver for the five supported components.</span></div></div><div className="rule-card"><div className="rule-title"><ShieldCheck size={16} /> Live workflow</div><div className="rule-row"><span className="rule-ok">✓</span><span>Snap-to-pin</span></div><div className="rule-row"><span className="rule-ok">✓</span><span>Editable wire anchors</span></div><div className="rule-row"><span className="rule-ok">✓</span><span>Junction-aware topology</span></div><div className="rule-row"><span className="rule-ok">✓</span><span>Backend DC simulation</span></div></div></div>}
        </aside> : <button className="reopen-inspector" onClick={() => setRightPanelOpen(true)}><Menu size={17} /> Inspector</button>}
      </div>

      {renameOpen && <div className="modal-backdrop" onMouseDown={() => setRenameOpen(false)}><div className="rename-modal" onMouseDown={(event) => event.stopPropagation()}><div className="rename-title"><div><strong>Rename electrical net</strong><span>{activeEdge?.data?.signal ?? 'Signal'} connection</span></div><button className="mini-btn" onClick={() => setRenameOpen(false)}><X size={16} /></button></div><label>Net name</label><input ref={renameInput} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') renameNet(); }} /><div className="rename-actions"><button className="soft-btn" onClick={() => setRenameOpen(false)}>Cancel</button><button className="primary-btn" onClick={renameNet}><Check size={15} /> Save label</button></div></div></div>}
      {toast && <div className="toast"><Sparkles size={16} /> {toast}</div>}
    </div>
  );
}

class ErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('[KLS runtime error]', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 32, background: '#fff7f7', fontFamily: 'system-ui' }}><div style={{ maxWidth: 900, padding: 28, borderRadius: 18, background: 'white', border: '1px solid #fecaca', boxShadow: '0 22px 60px rgba(0,0,0,.12)' }}><h1 style={{ marginTop: 0 }}>KLS Smart Wiring — runtime error</h1><p style={{ color: '#b91c1c' }}>The editor crashed. Check DevTools → Console for the first red error.</p><pre style={{ whiteSpace: 'pre-wrap', background: '#111827', color: '#fecaca', padding: 18, borderRadius: 12 }}>{this.state.error.message}</pre><button onClick={() => location.reload()}>Reload</button></div></div>;
  }
}

window.addEventListener('error', (event) => console.error('[KLS window error]', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => console.error('[KLS unhandled rejection]', event.reason));

function Root() { return <ReactFlowProvider><App /></ReactFlowProvider>; }
createRoot(document.getElementById('root')!).render(<ErrorBoundary><React.StrictMode><Root /></React.StrictMode></ErrorBoundary>);
