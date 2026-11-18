// These probes expose the interactive graph's live coordinate system to its browser specs.
const stage = () => document.querySelector<HTMLElement>(".storyboard-graph-view")!;

function matrix() {
  const world = document.querySelector<HTMLElement>(".storyboard-graph-world")!;
  return new DOMMatrix(world.style.transform);
}

function camera() {
  const { a: zoom, e: x, f: y } = matrix();
  return { x, y, zoom };
}

function position(element: Element) {
  const { left, top } = (element as HTMLElement).style;
  return { x: parseFloat(left), y: parseFloat(top) };
}

function positions() {
  return Array.from(document.querySelectorAll(".storyboard-graph-dot"), position);
}

function waitForFrame() {
  return new Promise(requestAnimationFrame);
}

export const graphGeometry = {
  camera,
  position,
  positions,
  nodeRadius(id: string) {
    return document.querySelector<SVGCircleElement>(`[data-graph-node="${id}"]`)!.r.baseVal.value;
  },
  scrubProgress(id: string) {
    const progress = document.querySelector<HTMLElement>(
      `[data-preview-shot-id="${id}"] .shot-hover-progress > span`,
    );
    return progress ? Number.parseFloat(progress.style.width) / 100 : null;
  },
  async settled() {
    const before = JSON.stringify(positions());
    for (let i = 0; i < 5; i++) await waitForFrame();
    return JSON.stringify(positions()) === before;
  },
  async cameraTrace() {
    const trace = [];
    for (let i = 0; i < 12; i++) {
      await waitForFrame();
      trace.push(camera());
    }
    return trace;
  },
  worldPoint(x: number, y: number) {
    const view = stage();
    const bounds = view.getBoundingClientRect();
    const { a, d, e, f } = matrix();
    return {
      x: bounds.left + view.clientLeft + e + x * a,
      y: bounds.top + view.clientTop + f + y * d,
    };
  },
  viewport() {
    const frame = document.querySelector<SVGRectElement>("[data-graph-viewport]")!;
    const { width, height } = frame.ownerSVGElement!.viewBox.baseVal;
    return {
      x: frame.x.baseVal.value / width,
      y: frame.y.baseVal.value / height,
      width: frame.width.baseVal.value / width,
      height: frame.height.baseVal.value / height,
    };
  },
  framing() {
    const view = stage();
    const { x, y, zoom } = camera();
    const canvas = JSON.parse(view.dataset.graphCanvas!) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return {
      canvas,
      zoom,
      width: view.clientWidth / zoom / canvas.width,
      height: view.clientHeight / zoom / canvas.height,
      x: ((view.clientWidth / 2 - x) / zoom - canvas.x) / canvas.width,
      y: ((view.clientHeight / 2 - y) / zoom - canvas.y) / canvas.height,
    };
  },
};
