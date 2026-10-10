import { readFileSync } from 'node:fs';
import * as scenarioSchema from '../../src/scenario.js';
import * as experimentSchema from '../../src/experiment.js';

// Execute only checked-in app source with DOM/Worker stand-ins. This covers
// handler state and result rendering, never browser layout, file pickers or QA.
export function application({ workerConstructionError = () => null, mapClass = null, now = () => performance.now() } = {}) {
  const created = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
      this.style = {}; this.dataset = {}; this.attributes = new Map();
      this.value = ''; this.max = '3600'; this.disabled = false; this.hidden = false;
      this.parentElement = this; this._text = ''; this._classes = new Set();
      this.classList = {
        toggle: (name, force) => {
          const enabled = force === undefined ? !this._classes.has(name) : Boolean(force);
          if (enabled) this._classes.add(name); else this._classes.delete(name);
          return enabled;
        },
        remove: (...names) => names.forEach(name => this._classes.delete(name)),
        add: (...names) => names.forEach(name => this._classes.add(name)),
        contains: name => this._classes.has(name),
      };
      created.push(this);
    }
    get className() { return [...this._classes].join(' '); }
    set className(value) { this._classes = new Set(value.split(/\s+/u).filter(Boolean)); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; }
    set innerHTML(_value) { throw new Error('Application must render supplied labels as text, never HTML.'); }
    addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    replaceChildren(...items) {
      this._text = ''; this.children = []; this.append(...items);
      if (this.tagName === 'SELECT') this.value = items[0]?.value ?? '';
    }
    append(...items) { for (const item of items) { item.parentElement = this; this.children.push(item); } }
    closest(selector) {
      if (selector.startsWith('.')) {
        let current = this;
        while (current) {
          if (current.classList?.contains(selector.slice(1))) return current;
          if (current.parentElement === current) break;
          current = current.parentElement;
        }
      }
      return this;
    }
    emit(name, event = {}) { return Promise.all((this.listeners[name] ?? []).map(callback => callback({ target: this, ...event }))); }
    click() { return this.disabled ? Promise.resolve([]) : this.emit('click'); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const elements = new Map();
  const selectIds = new Set(['variant-select', 'road-select', 'road-direction', 'vehicle-select', 'speed']);
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element(selectIds.has(id) ? 'select' : 'div'));
    return elements.get(id);
  };
  element('closure-time').value = '300'; element('road-direction').value = 'both';
  const posted = [], workers = [], maps = [], timers = new Map(), animationFrames = [];
  let timerId = 0;
  const document = {
    getElementById: element, createElement: tag => new Element(tag),
    createTextNode: text => ({ textContent: String(text) }), documentElement: new Element('html'),
    addEventListener() {}, activeElement: new Element(),
  };
  class NetworkMap {
    constructor(_element, state, handlers) { this.width = 800; this.state = state; this.handlers = handlers; maps.push(this); }
    invalidate() {} invalidateFrame() {} render() {}
  }
  class FakeWorker {
    constructor(url, options) {
      const error = workerConstructionError(); if (error) throw new Error(error);
      this.url = url; this.options = options; this.terminated = false; this.terminateCount = 0; this.requests = []; workers.push(this); }
    postMessage(message) { this.request = structuredClone(message); this.requests.push(this.request); posted.push(this.request); }
    terminate() { this.terminated = true; this.terminateCount += 1; }
    // Allow messages even after termination to exercise queued stale delivery.
    respond(result = experimentSchema.simulateExperiment(this.request.experiment), id = this.request.id) {
      this.onmessage?.({ data: structuredClone({ id, ...result }) });
      return result;
    }
    fail(message = 'Synthetic worker failure') { this.onerror?.({ message }); }
  }
  const url = new URL('../../src/app.js', import.meta.url);
  const source = readFileSync(url, 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(url.href));
  const environment = {
    ...scenarioSchema, ...experimentSchema, document, NetworkMap: mapClass ? class extends mapClass {
      constructor(...args) { super(...args); maps.push(this); }
    } : NetworkMap, Worker: FakeWorker,
    URL, Blob, TextEncoder, performance: { now }, structuredClone,
    window: { addEventListener() {} }, requestAnimationFrame(callback) { animationFrames.push(callback); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  // No scenario data is evaluated as code.
  new Function(...Object.keys(environment), source)(...Object.values(environment));
  return {
    element, document, created, posted, workers, timers,
    stepAnimationFrame(timestamp) { const callbacks = animationFrames.splice(0); for (const callback of callbacks) callback(timestamp); return callbacks.length; },
    pendingAnimationFrames: () => animationFrames.length,
    map: maps[0], state: maps[0].state,
    latestWorker: () => workers.at(-1),
    latestExperiment: () => posted.at(-1).experiment,
    latestScenario: () => posted.at(-1).experiment.baseScenario,
    async change(id, value, event = 'change') { element(id).value = String(value); return element(id).emit(event); },
    importFile: file => element('import-input').emit('change', { target: { files: [file], value: '' } }),
    importExperiment: experiment => element('import-input').emit('change', { target: { files: [{ size: 100, text: async () => JSON.stringify(experiment) }], value: '' } }),
  };
}

export function deferredFile() {
  let resolve, reject;
  const value = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { file: { size: 100, text: () => value }, resolve, reject };
}

export function minimalScenario(id = 'minimal-directed') {
  const value = JSON.parse(readFileSync(new URL('../../examples/minimal-directed.json', import.meta.url), 'utf8'));
  value.id = id; value.name = id;
  return value;
}

export function scenarioText(id) { return JSON.stringify(minimalScenario(id)); }
