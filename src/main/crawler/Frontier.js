'use strict';

const { normalizeUrl } = require('./utils');

/**
 * Frontier — the URL queue ("the frontier") plus the visited set.
 *
 * Supports two traversal orders:
 *   - 'bfs' (breadth-first, FIFO)  → discovers a site level by level.
 *   - 'dfs' (depth-first, LIFO)    → dives deep along one branch first.
 *
 * De-duplication is by normalized URL, so the same page reached via different
 * relative links is only crawled once.
 */
class Frontier {
  constructor({ order = 'bfs' } = {}) {
    this.order = order;
    this.queue = [];
    this.seen = new Set(); // normalized URLs ever enqueued
    this.queuedCount = 0;
    this.totalEnqueued = 0;
  }

  /**
   * Enqueue a candidate URL at a given depth.
   * @returns {boolean} true if newly added, false if a duplicate/invalid.
   */
  add(url, depth = 0, parent = null) {
    const norm = normalizeUrl(url);
    if (!norm) return false;
    if (this.seen.has(norm)) return false;
    this.seen.add(norm);
    this.queue.push({ url: norm, depth, parent });
    this.queuedCount++;
    this.totalEnqueued++;
    return true;
  }

  /** Mark a URL as seen without queuing it (e.g. blocked by robots/scope). */
  markSeen(url) {
    const norm = normalizeUrl(url);
    if (norm) this.seen.add(norm);
  }

  has(url) {
    const norm = normalizeUrl(url);
    return norm ? this.seen.has(norm) : false;
  }

  /** Pull the next item according to the traversal order, or null if empty. */
  next() {
    if (this.queue.length === 0) return null;
    const item = this.order === 'dfs' ? this.queue.pop() : this.queue.shift();
    this.queuedCount--;
    return item;
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  get size() {
    return this.queue.length;
  }

  get seenSize() {
    return this.seen.size;
  }
}

module.exports = Frontier;
