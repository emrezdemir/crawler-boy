'use strict';

const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');

/**
 * AnalyzerPool — a pool of worker threads that parse HTML and run recon off the
 * main thread, keeping Electron's UI responsive under load.
 *
 * Tasks are queued and dispatched to idle workers. A per-task timeout guards
 * against a pathological document hanging a worker: the worker is terminated,
 * the task rejected, and a fresh worker spawned.
 */
class AnalyzerPool {
  constructor({ size, taskTimeout = 25000 } = {}) {
    const cpu = (os.cpus() || []).length || 4;
    // Leave headroom for the main process + render windows.
    this.size = Math.max(1, Math.min(size || cpu - 1, 8));
    this.taskTimeout = taskTimeout;
    this.workerPath = path.join(__dirname, 'analyzer-worker.js');

    this.workers = [];
    this.idle = [];
    this.queue = []; // pending task messages
    this.pending = new Map(); // id -> { resolve, reject, worker, timer }
    this._id = 0;
    this._destroyed = false;

    for (let i = 0; i < this.size; i++) this._spawn();
  }

  _spawn() {
    const w = new Worker(this.workerPath);
    w.on('message', (m) => this._onMessage(w, m));
    w.on('error', (e) => this._onError(w, e));
    w.on('exit', () => this._onExit(w));
    w._currentId = null;
    this.workers.push(w);
    this.idle.push(w);
  }

  /** Analyze a document off-thread. Resolves with {meta, links, assets, forms, intel?, security?}. */
  analyze(html, baseUrl, opts = {}) {
    return new Promise((resolve, reject) => {
      if (this._destroyed) return reject(new Error('pool destroyed'));
      const id = ++this._id;
      this.pending.set(id, { resolve, reject, worker: null, timer: null });
      this.queue.push({ id, html, baseUrl, intel: !!opts.intel, audit: !!opts.audit, headers: opts.headers || null });
      this._drain();
    });
  }

  _drain() {
    while (this.queue.length && this.idle.length) {
      const w = this.idle.pop();
      const msg = this.queue.shift();
      const entry = this.pending.get(msg.id);
      if (!entry) continue; // already settled/cancelled
      w._currentId = msg.id;
      entry.worker = w;
      entry.timer = setTimeout(() => this._onTimeout(w, msg.id), this.taskTimeout);
      w.postMessage(msg);
    }
  }

  _settle(id, fn) {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.pending.delete(id);
    fn(entry);
  }

  _onMessage(w, m) {
    w._currentId = null;
    if (!this.idle.includes(w) && this.workers.includes(w)) this.idle.push(w);
    this._settle(m.id, (entry) => {
      if (m.ok) entry.resolve(m.result);
      else entry.reject(new Error(m.error));
    });
    this._drain();
  }

  _onTimeout(w, id) {
    this._settle(id, (entry) => entry.reject(new Error('analyze-timeout')));
    this._replace(w); // a hung worker can't be trusted — replace it
  }

  _onError(w, err) {
    const id = w._currentId;
    if (id != null) this._settle(id, (entry) => entry.reject(err));
    this._replace(w);
  }

  _onExit(w) {
    // If a worker exits unexpectedly while busy, fail its task and replace it.
    const id = w._currentId;
    if (id != null) this._settle(id, (entry) => entry.reject(new Error('worker exited')));
    if (!this._destroyed) this._replace(w);
  }

  _replace(w) {
    this.workers = this.workers.filter((x) => x !== w);
    this.idle = this.idle.filter((x) => x !== w);
    try {
      w.terminate();
    } catch {
      /* already gone */
    }
    if (!this._destroyed && this.workers.length < this.size) this._spawn();
    this._drain();
  }

  async destroy() {
    this._destroyed = true;
    for (const entry of this.pending.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error('pool destroyed'));
    }
    this.pending.clear();
    this.queue = [];
    const ws = this.workers.slice();
    this.workers = [];
    this.idle = [];
    await Promise.all(ws.map((w) => w.terminate().catch(() => {})));
  }
}

module.exports = AnalyzerPool;
