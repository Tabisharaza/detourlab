// Bounded Canvas/DOM stand-ins for executing NetworkMap. Operations are recorded;
// this is not a rasterizer, browser layout engine, or visual/performance QA.
const styleDefaults = {
  fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, globalAlpha: 1,
  shadowColor: 'rgba(0, 0, 0, 0)', shadowBlur: 0, font: '10px sans-serif',
  textAlign: 'start', lineJoin: 'miter', lineCap: 'butt',
};

function createContext(recordOperations) {
  const stack = [];
  const context = {
    ...styleDefaults, operations: [], operationCount: 0, counts: Object.create(null),
    count(method) { return this.counts[method] ?? 0; },
    reset() { this.operations.length = 0; this.operationCount = 0; this.counts = Object.create(null); },
  };
  const record = (method, args) => {
    context.counts[method] = context.count(method) + 1;
    context.operationCount += 1;
    if (recordOperations) context.operations.push({ method, args, styles: Object.fromEntries(Object.keys(styleDefaults).map(key => [key, context[key]])) });
  };
  for (const method of ['setTransform', 'clearRect', 'drawImage', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'fill', 'stroke', 'ellipse', 'arc', 'fillRect', 'strokeRect', 'translate', 'rotate', 'fillText', 'setLineDash']) {
    context[method] = (...args) => record(method, args);
  }
  context.save = () => { record('save', []); stack.push(Object.fromEntries(Object.keys(styleDefaults).map(key => [key, context[key]]))); };
  context.restore = () => { record('restore', []); Object.assign(context, stack.pop()); };
  context.measureText = text => { record('measureText', [text]); return { width: String(text).length * 5 }; };
  return context;
}

export function createCanvasEnvironment({ width = 800, height = 600, dpr = 1, reducedMotion = false, recordOperations = true } = {}) {
  const canvases = [], observers = [];
  let pixelRatio = dpr;
  function createCanvas(options = {}) {
    const context = createContext(recordOperations), listeners = new Map();
    let rect = { width, height, left: 0, top: 0, ...options };
    const canvas = {
      width: 300, height: 150, context,
      getContext(type) { if (type !== '2d') throw new Error(`Unsupported canvas context: ${type}`); return context; },
      getBoundingClientRect: () => ({ ...rect }),
      setRect(value) { rect = { ...rect, ...value }; },
      addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(callback); },
      emit(name, event = {}) { for (const callback of listeners.get(name) ?? []) callback({ target: canvas, ...event }); },
    };
    canvases.push(canvas);
    return canvas;
  }
  const canvas = createCanvas();
  const document = { createElement(tag) { if (tag !== 'canvas') throw new Error(`Unsupported element: ${tag}`); return createCanvas(); } };
  const matchMedia = () => ({ matches: reducedMotion });
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); this.callback([{ target }]); }
    disconnect() { this.targets.clear(); }
  }
  return {
    canvas, canvases, document, matchMedia, ResizeObserver, createCanvas,
    setDpr(value) { pixelRatio = value; },
    resize(target, nextWidth, nextHeight) {
      target.setRect({ width: nextWidth, height: nextHeight });
      for (const observer of observers) if (observer.targets.has(target)) observer.callback([{ target }]);
    },
    reset() { for (const item of canvases) item.context.reset(); },
    install({ document: suppliedDocument = document } = {}) {
      const values = { document: suppliedDocument, matchMedia, ResizeObserver };
      const descriptors = Object.fromEntries([...Object.keys(values), 'devicePixelRatio'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
      for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, get: () => pixelRatio });
      return () => {
        for (const [key, descriptor] of Object.entries(descriptors)) {
          if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
        }
      };
    },
  };
}
