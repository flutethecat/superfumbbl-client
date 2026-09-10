export type SketchPoint = Readonly<{ x: number; y: number }>;
export type SketchTool = 'none' | 'pencil' | 'arrow' | 'circle' | 'select';

interface SketchElementBase { id: string; thickness: number; color: TelestratorColor }
export interface SketchStroke extends SketchElementBase { kind: 'stroke'; points: readonly SketchPoint[] }
export interface SketchArrow extends SketchElementBase { kind: 'arrow'; from: SketchPoint; to: SketchPoint }
export interface SketchCircle extends SketchElementBase {
  kind: 'circle'; center: SketchPoint; radiusX: number; radiusY: number;
}
export type SketchElement = SketchStroke | SketchArrow | SketchCircle;

export interface TelestratorState {
  expanded: boolean;
  tool: SketchTool;
  thickness: number;
  color: TelestratorColor;
  selectedId: string | null;
  elements: readonly SketchElement[];
  /** Visible, local-only feedback when a drawing cannot grow further. */
  limitNotice: string | null;
}

/** Keeps retained SVG nodes and per-frame path serialization bounded for a whole review session. */
export const TELESTRATOR_MAX_ELEMENTS = 128;
export const TELESTRATOR_MAX_POINTS = 4096;
export const TELESTRATOR_MAX_POINTS_PER_STROKE = 1024;
export const TELESTRATOR_LIMIT_NOTICE = 'Sketch limit reached — undo or clear a drawing.';
export const TELESTRATOR_STROKE_LIMIT_NOTICE = 'Stroke limit reached — start a new stroke.';

// Owner 08-17: fixed SCREEN pt weights (2/4/6/8), not a pitch-square fraction — the prior
// 0.10/0.18/0.30/0.45 scaled with camera zoom (thicker zoomed in, thinner zoomed out), which the
// owner found too heavy; a stroke's on-screen weight is now constant regardless of zoom
// (ReplayTelestrator.vue renders it via vector-effect="non-scaling-stroke"), while its drawn
// POSITION still tracks the pitch (world-space points, reprojected through the live camera).
export const TELESTRATOR_MIN_THICKNESS = 2;
export const TELESTRATOR_MAX_THICKNESS = 8;
export const TELESTRATOR_DEFAULT_THICKNESS = 4;
export const TELESTRATOR_THICKNESS_PRESETS = [
  TELESTRATOR_MIN_THICKNESS,
  TELESTRATOR_DEFAULT_THICKNESS,
  6,
  TELESTRATOR_MAX_THICKNESS,
] as const;

export const TELESTRATOR_RED = '#e33b3b';
export const TELESTRATOR_BLUE = '#33aaff';
export const TELESTRATOR_GREEN = '#9be33b';
export const TELESTRATOR_GOLD = '#ffcc33';
export const TELESTRATOR_COLOR_PRESETS = [
  { name: 'Red', value: TELESTRATOR_RED },
  { name: 'Blue', value: TELESTRATOR_BLUE },
  { name: 'Green', value: TELESTRATOR_GREEN },
  { name: 'Gold', value: TELESTRATOR_GOLD },
] as const;
export type TelestratorColor = typeof TELESTRATOR_COLOR_PRESETS[number]['value'];
export const TELESTRATOR_DEFAULT_COLOR: TelestratorColor = TELESTRATOR_RED;

export const clampThickness = (value: number) => Math.min(
  TELESTRATOR_MAX_THICKNESS,
  Math.max(TELESTRATOR_MIN_THICKNESS, value),
);
const copyPoint = (point: SketchPoint): SketchPoint => ({ x: Number(point.x), y: Number(point.y) });
const movePoint = (point: SketchPoint, dx: number, dy: number): SketchPoint => ({ x: point.x + dx, y: point.y + dy });

/** Local pitch-coordinate drawings. This class has deliberately no transport dependency. */
export class ReplayTelestrator {
  private value: TelestratorState = {
    expanded: false,
    tool: 'none',
    thickness: TELESTRATOR_DEFAULT_THICKNESS,
    color: TELESTRATOR_DEFAULT_COLOR,
    selectedId: null,
    elements: [],
    limitNotice: null,
  };
  private draft: SketchElement | null = null;
  private nextId = 1;

  state(): Readonly<TelestratorState> { return this.value; }
  draftElement(): Readonly<SketchElement> | null { return this.draft; }
  setExpanded(expanded: boolean): void {
    this.value = {
      ...this.value,
      expanded,
      tool: expanded ? this.value.tool : 'none',
      selectedId: expanded ? this.value.selectedId : null,
    };
    if (!expanded) this.draft = null;
  }
  selectTool(tool: SketchTool): void {
    const next = this.value.tool === tool && tool !== 'select' ? 'none' : tool;
    this.value = { ...this.value, expanded: true, tool: next, selectedId: next === 'select' ? this.value.selectedId : null };
    this.draft = null;
  }
  finishInteraction(): void {
    this.value = { ...this.value, tool: 'none' };
  }
  setThickness(value: number): void { this.value = { ...this.value, thickness: clampThickness(value) }; }
  setColor(color: TelestratorColor): void { this.value = { ...this.value, color }; }

  begin(at: SketchPoint): boolean {
    const requiredPoints = 2;
    if (this.value.elements.length >= TELESTRATOR_MAX_ELEMENTS
      || this.pointCount() + requiredPoints > TELESTRATOR_MAX_POINTS) {
      this.draft = null;
      this.value = { ...this.value, limitNotice: TELESTRATOR_LIMIT_NOTICE };
      return false;
    }
    const id = `sketch-${this.nextId++}`;
    const start = copyPoint(at);
    const style = { thickness: this.value.thickness, color: this.value.color };
    if (this.value.tool === 'pencil') this.draft = { id, kind: 'stroke', ...style, points: [start] };
    else if (this.value.tool === 'arrow') this.draft = { id, kind: 'arrow', ...style, from: start, to: start };
    else if (this.value.tool === 'circle') {
      this.draft = { id, kind: 'circle', ...style, center: start, radiusX: 0, radiusY: 0 };
    }
    this.value = { ...this.value, limitNotice: null };
    return this.draft !== null;
  }

  update(at: SketchPoint): void {
    if (!this.draft) return;
    const current = copyPoint(at);
    if (this.draft.kind === 'stroke') {
      const prior = this.draft.points[this.draft.points.length - 1];
      if (!prior || current.x !== prior.x || current.y !== prior.y) {
        if (this.draft.points.length >= TELESTRATOR_MAX_POINTS_PER_STROKE) {
          this.value = { ...this.value, limitNotice: TELESTRATOR_STROKE_LIMIT_NOTICE };
          return;
        }
        if (this.pointCount() + this.draft.points.length >= TELESTRATOR_MAX_POINTS) {
          this.value = { ...this.value, limitNotice: TELESTRATOR_LIMIT_NOTICE };
          return;
        }
        this.draft = { ...this.draft, points: [...this.draft.points, current] };
      }
    } else if (this.draft.kind === 'arrow') this.draft = { ...this.draft, to: current };
    else this.draft = {
      ...this.draft,
      radiusX: Math.abs(current.x - this.draft.center.x),
      radiusY: Math.abs(current.y - this.draft.center.y),
    };
  }

  commit(): SketchElement | null {
    const element = this.draft;
    this.draft = null;
    if (!element || this.degenerate(element)) return null;
    this.value = { ...this.value, elements: [...this.value.elements, element], selectedId: element.id };
    return element;
  }
  cancelDraft(): void { this.draft = null; }
  select(id: string | null): void {
    this.value = {
      ...this.value,
      tool: 'select',
      selectedId: id && this.value.elements.some((element) => element.id === id) ? id : null,
    };
  }
  moveSelected(dx: number, dy: number): void {
    if (!this.value.selectedId) return;
    this.replace(this.value.selectedId, (element) => {
      if (element.kind === 'stroke') return { ...element, points: element.points.map((point) => movePoint(point, dx, dy)) };
      if (element.kind === 'arrow') return { ...element, from: movePoint(element.from, dx, dy), to: movePoint(element.to, dx, dy) };
      return { ...element, center: movePoint(element.center, dx, dy) };
    });
  }
  resizeSelected(scaleX: number, scaleY = scaleX): void {
    if (!this.value.selectedId || scaleX <= 0 || scaleY <= 0) return;
    this.replace(this.value.selectedId, (element) => {
      if (element.kind === 'circle') return { ...element, radiusX: element.radiusX * scaleX, radiusY: element.radiusY * scaleY };
      const center = this.center(element);
      const scale = (point: SketchPoint): SketchPoint => ({
        x: center.x + (point.x - center.x) * scaleX,
        y: center.y + (point.y - center.y) * scaleY,
      });
      if (element.kind === 'stroke') return { ...element, points: element.points.map(scale) };
      return { ...element, from: scale(element.from), to: scale(element.to) };
    });
  }
  replaceSelectedShape(kind: 'arrow' | 'circle'): void {
    if (!this.value.selectedId) return;
    this.replace(this.value.selectedId, (element) => {
      if (element.kind === kind || element.kind === 'stroke') return element;
      if (kind === 'circle' && element.kind === 'arrow') {
        return {
          id: element.id,
          kind,
          thickness: element.thickness,
          color: element.color,
          center: { x: (element.from.x + element.to.x) / 2, y: (element.from.y + element.to.y) / 2 },
          radiusX: Math.max(0.03, Math.abs(element.to.x - element.from.x) / 2),
          radiusY: Math.max(0.03, Math.abs(element.to.y - element.from.y) / 2),
        };
      }
      if (kind === 'arrow' && element.kind === 'circle') {
        return {
          id: element.id,
          kind,
          thickness: element.thickness,
          color: element.color,
          from: { x: element.center.x - element.radiusX, y: element.center.y },
          to: { x: element.center.x + element.radiusX, y: element.center.y },
        };
      }
      return element;
    });
  }
  undo(): void {
    const removed = this.value.elements[this.value.elements.length - 1];
    if (!removed) return;
    this.value = {
      ...this.value,
      elements: this.value.elements.slice(0, -1),
      selectedId: this.value.selectedId === removed.id ? null : this.value.selectedId,
      limitNotice: null,
    };
  }
  clear(): void { this.draft = null; this.value = { ...this.value, elements: [], selectedId: null, limitNotice: null }; }
  resetForSession(): void {
    this.nextId = 1;
    this.draft = null;
    this.value = {
      expanded: false,
      tool: 'none',
      thickness: TELESTRATOR_DEFAULT_THICKNESS,
      color: TELESTRATOR_DEFAULT_COLOR,
      selectedId: null,
      elements: [],
      limitNotice: null,
    };
  }

  private replace(id: string, transform: (element: SketchElement) => SketchElement): void {
    this.value = { ...this.value, elements: this.value.elements.map((element) => element.id === id ? transform(element) : element) };
  }
  private pointCount(): number {
    return this.value.elements.reduce((total, element) => total + (element.kind === 'stroke' ? element.points.length : 2), 0);
  }
  private center(element: SketchStroke | SketchArrow): SketchPoint {
    const points = element.kind === 'stroke' ? element.points : [element.from, element.to];
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }
  private degenerate(element: SketchElement): boolean {
    if (element.kind === 'stroke') return element.points.length < 2;
    if (element.kind === 'arrow') return Math.hypot(element.to.x - element.from.x, element.to.y - element.from.y) < 0.05;
    return element.radiusX < 0.03 || element.radiusY < 0.03;
  }
}
