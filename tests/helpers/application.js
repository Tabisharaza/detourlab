import { readFileSync } from 'node:fs';
import * as scenarioSchema from '../../src/scenario.js';
import * as experimentSchema from '../../src/experiment.js';
import * as fileInput from '../../src/file-input.js';
import { createBrowserReview } from '../../src/browser-review.js';
import { createTutorialExperiment } from '../../src/tutorial.js';

// Execute only checked-in app source with DOM/Worker stand-ins. This covers
// handler state and result rendering, never browser layout, file pickers or QA.
export function application({ workerConstructionError = () => null, mapClass = null, now = () => performance.now(), deferDialogClose = false, reviewBuilder = createBrowserReview } = {}) {
  const created = [];
  const markup = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const closeEvents = [];
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
      this.style = {}; this.dataset = {}; this.attributes = new Map();
      this.value = ''; this.max = '3600'; this.disabled = false; this.hidden = false;
      this.parentElement = null; this._text = ''; this._classes = new Set();
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
    get isConnected() { return this === document.documentElement || Boolean(this.parentElement?.isConnected); }
    get tabIndex() { return this.attributes.has('tabindex') ? Number(this.getAttribute('tabindex')) : ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) || this.attributes.has('href') ? 0 : -1; }
    set tabIndex(value) { this.setAttribute('tabindex', value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    set innerHTML(_value) { throw new Error('Application must render supplied labels as text, never HTML.'); }
    addEventListener(name, callback) { (this.listeners[name] ??= []).push(callback); }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === 'class') this.className = value;
      if (['disabled', 'hidden', 'inert'].includes(name)) this[name] = true;
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    getClientRects() {
      for (let current = this; current; current = current.parentElement) {
        if (current.hidden || current.style.display === 'none' || current.tagName === 'DIALOG' && !current.open) return [];
      }
      return this.isConnected ? [{}] : [];
    }
    replaceChildren(...items) {
      for (const child of this.children) {
        if (child.contains?.(document.activeElement)) document.activeElement = document.body;
        child.parentElement = null;
      }
      this._text = ''; this.children = []; this.append(...items);
      if (this.tagName === 'SELECT') this.value = items[0]?.value ?? '';
    }
    append(...items) { for (const item of items) { item.remove?.(); item.parentElement = this; this.children.push(item); } }
    insertBefore(item, reference) {
      if (reference === item) return item;
      if (reference !== null && !this.children.includes(reference)) throw new Error('Reference node is not a child.');
      item.remove?.(); item.parentElement = this;
      this.children.splice(reference === null ? this.children.length : this.children.indexOf(reference), 0, item);
      return item;
    }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(item => item !== this);
      this.parentElement = null;
    }
    contains(element) { for (let current = element; current; current = current.parentElement) if (current === this) return true; return false; }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part === ':disabled') return this.disabled || ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(this.tagName) && Boolean(this.parentElement?.closest('fieldset')?.disabled);
        if (part === '[hidden]') return this.hidden;
        if (part === '[inert]') return this.inert;
        if (part.startsWith('[')) return this.attributes.has(part.slice(1, -1));
        if (part.startsWith('.')) return this.classList.contains(part.slice(1));
        return this.tagName === part.toUpperCase();
      });
    }
    closest(selector) {
      for (let current = this; current; current = current.parentElement) if (current.matches(selector)) return current;
      return null;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches?.(selector) ? [child] : []), ...(child.querySelectorAll?.(selector) ?? [])]); }
    emit(name, event = {}) {
      event.target ??= this; event.defaultPrevented ??= false; event.preventDefault ??= function () { this.defaultPrevented = true; };
      return Promise.all((this.listeners[name] ?? []).map(callback => callback(event)));
    }
    click() { return this.disabled ? Promise.resolve([]) : this.emit('click'); }
    focus() { if (!this.matches(':disabled') && this.getClientRects().length && !this.closest('[inert]') && !['hidden', 'collapse'].includes(computedStyle(this).visibility)) document.activeElement = this; }
    showModal() { if (this.open) return; this._previousFocus = document.activeElement; this.open = true; this.focus(); }
    close() {
      if (!this.open) return;
      this.open = false;
      if (this.contains(document.activeElement)) { document.activeElement = document.body; this._previousFocus?.focus(); }
      if (deferDialogClose) { closeEvents.push(() => this.emit('close')); return; }
      return this.emit('close');
    }
    async escape() { const event = {}; await this.emit('cancel', event); if (!event.defaultPrevented) await this.close(); }
  }
  const elements = new Map();
  const element = id => {
    const result = elements.get(id);
    if (!result) throw new Error(`Unknown checked-in element: ${id}`);
    return result;
  };
  const posted = [], workers = [], maps = [], timers = new Map(), animationFrames = [];
  let timerId = 0;
  const document = {
    getElementById: element, createElement: tag => new Element(tag),
    createTextNode: text => ({ textContent: String(text) }), documentElement: new Element('html'),
    addEventListener() {}, activeElement: new Element(),
  };
  // A limited tree of our checked-in markup, not a browser HTML/CSS parser.
  // Relationships let focused handler tests model hidden ancestors, detached
  // triggers and dialog controls without hard-coding the modal's button list.
  const stack = [], voidTags = new Set(['meta', 'link', 'img', 'input', 'br', 'hr']);
  for (const match of markup.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*)>/gu)) {
    const [, closing, tag, attributes] = match;
    if (closing) { stack.pop(); continue; }
    const item = tag === 'html' ? document.documentElement : new Element(tag);
    for (const attribute of attributes.matchAll(/([\w-]+)(?:="([^"]*)")?/gu)) {
      const [, name, value = ''] = attribute; item.setAttribute(name, value);
      if (['value', 'max', 'step', 'type'].includes(name)) item[name] = value;
    }
    const id = item.getAttribute('id'); if (id) elements.set(id, item);
    stack.at(-1)?.append(item);
    if (tag === 'body') document.body = item;
    if (!voidTags.has(tag)) stack.push(item);
  }
  created.length = 0; // Track app-created nodes, not safe static markup such as the module script.
  document.activeElement = document.body;
  element('road-direction').value = 'both';
  function computedStyle(item) { return { visibility: item.style.visibility || (item.parentElement ? computedStyle(item.parentElement).visibility : 'visible') }; }
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
  const windowListeners = new Map();
  const window = { addEventListener(name, handler) { if (!windowListeners.has(name)) windowListeners.set(name, []); windowListeners.get(name).push(handler); } };
  const environment = {
    ...scenarioSchema, ...experimentSchema, ...fileInput, createBrowserReview: reviewBuilder, createTutorialExperiment, document, getComputedStyle: computedStyle, NetworkMap: mapClass ? class extends mapClass {
      constructor(...args) { super(...args); maps.push(this); }
    } : NetworkMap, Worker: FakeWorker,
    URL, Blob, TextEncoder, TextDecoder, performance: { now }, structuredClone,
    window, requestAnimationFrame(callback) { animationFrames.push(callback); },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  // No scenario data is evaluated as code.
  new Function(...Object.keys(environment), source)(...Object.values(environment));
  return {
    element, document, created, posted, workers, timers,
    pendingDialogCloseEvents: () => closeEvents.length,
    async flushDialogCloseEvents() { const callbacks = closeEvents.splice(0); for (const callback of callbacks) await callback(); return callbacks.length; },
    windowEvent(name, properties = {}) { const event = { target: document.activeElement, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties }; for (const handler of windowListeners.get(name) ?? []) handler(event); return event; },
    stepAnimationFrame(timestamp) { const callbacks = animationFrames.splice(0); for (const callback of callbacks) callback(timestamp); return callbacks.length; },
    pendingAnimationFrames: () => animationFrames.length,
    map: maps[0], state: maps[0].state,
    latestWorker: () => workers.at(-1),
    latestExperiment: () => posted.at(-1).experiment,
    latestScenario: () => posted.at(-1).experiment.baseScenario,
    async change(id, value, event = 'change') { element(id).value = String(value); return element(id).emit(event); },
    importFile: file => element('import-input').emit('change', { target: { files: [file], value: '' } }),
    importExperiment: experiment => element('import-input').emit('change', { target: { files: [new Blob([JSON.stringify(experiment)], { type: 'application/json' })], value: '' } }),
  };
}

export function deferredFile() {
  let resolve, reject;
  const value = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { file: { size: 100, arrayBuffer: () => value }, resolve, reject };
}

export function minimalScenario(id = 'minimal-directed') {
  const value = JSON.parse(readFileSync(new URL('../../examples/minimal-directed.json', import.meta.url), 'utf8'));
  value.id = id; value.name = id;
  return value;
}

export function scenarioText(id) { return JSON.stringify(minimalScenario(id)); }
