/**
 * Script running inside the reader web view. It is plain ES5-style JavaScript kept in a
 * string (Hermes cannot serialise functions), and is unit tested with jsdom.
 *
 * Contract with React Native:
 * - configuration: `window.__LN_CONFIG` (see ReaderConfig in readerHtml.ts);
 * - commands: `window.LN.cmd({ name, ... })`;
 * - events: JSON messages `{ type, ... }` sent with ReactNativeWebView.postMessage.
 *
 * Positions use anchors `{ b, o, c }`: block index, character offset in the block text
 * and 30 characters of context, so that a place can be found again when the text changed.
 */
export const READER_RUNTIME = String.raw`
(function () {
  'use strict';
  var LN = (window.LN = {});
  var cfg = window.__LN_CONFIG || {};
  var root = document.documentElement;
  var pager = document.getElementById('pager');
  var content = document.getElementById('content');
  var endCard = document.getElementById('end');
  var blocks = [];
  var page = 0;
  var interacted = false;
  var lastSentPosition = 0;
  var positionTimer = null;
  var progressTimer = null;
  var lastActivity = 0;
  var autoScroll = { speed: 0, raf: 0, last: 0, carry: 0 };
  var search = { ranges: [], index: -1 };
  var quotes = [];
  var CONTEXT = 30;
  var BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,div,dt,dd,figcaption,td,th';

  function post(type, data) {
    var message = data || {};
    message.type = type;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(message));
    }
  }

  function isPaged() {
    return root.classList.contains('paged');
  }

  // ---------------------------------------------------------------- blocks and anchors

  function indexBlocks() {
    blocks = [];
    var all = content.querySelectorAll(BLOCK_SELECTOR);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.querySelector(BLOCK_SELECTOR)) continue;
      if (!el.textContent.trim() && !el.querySelector('img')) continue;
      el.setAttribute('data-b', String(blocks.length));
      blocks.push(el);
    }
  }

  function textNodes(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    return nodes;
  }

  /** DOM point (text node + offset) of a character offset inside a block. */
  function pointAt(el, offset) {
    var nodes = textNodes(el);
    var remaining = Math.max(0, offset);
    for (var i = 0; i < nodes.length; i++) {
      var length = nodes[i].data.length;
      if (remaining <= length) return { node: nodes[i], offset: remaining };
      remaining -= length;
    }
    if (nodes.length) {
      var last = nodes[nodes.length - 1];
      return { node: last, offset: last.data.length };
    }
    return { node: el, offset: 0 };
  }

  /** Character offset inside a block of a DOM point. */
  function offsetOf(el, node, nodeOffset) {
    if (node.nodeType !== 3) {
      var range = document.createRange();
      range.selectNodeContents(el);
      try {
        range.setEnd(node, nodeOffset);
      } catch (e) {
        return 0;
      }
      return range.toString().length;
    }
    var nodes = textNodes(el);
    var total = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) return total + nodeOffset;
      total += nodes[i].data.length;
    }
    return total;
  }

  function blockOf(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest('[data-b]') : null;
  }

  function makeAnchor(b, o) {
    var text = blocks[b] ? blocks[b].textContent : '';
    return { b: b, o: o, c: text.substr(o, CONTEXT) };
  }

  function findContext(context, around) {
    for (var d = 0; d < blocks.length; d++) {
      var candidates = d === 0 ? [around] : [around - d, around + d];
      for (var k = 0; k < candidates.length; k++) {
        var el = blocks[candidates[k]];
        if (!el) continue;
        var index = el.textContent.indexOf(context);
        if (index >= 0) return { b: candidates[k], o: index };
      }
    }
    return null;
  }

  /** Finds the place of an anchor, even when the text moved or changed a little. */
  function resolveAnchor(anchor) {
    if (!anchor || !blocks.length) return null;
    var b = Math.max(0, Math.min(blocks.length - 1, anchor.b | 0));
    var o = Math.max(0, anchor.o | 0);
    var context = anchor.c || '';
    var el = blocks[anchor.b];
    if (el && (!context || el.textContent.substr(o, context.length) === context)) {
      return { b: anchor.b, o: Math.min(o, el.textContent.length) };
    }
    if (context) {
      var found = findContext(context, b);
      if (!found && context.length > 12) found = findContext(context.substr(0, 12), b);
      if (found) return found;
    }
    return { b: b, o: Math.min(o, blocks[b].textContent.length) };
  }

  function rangeBetween(start, end) {
    var range = document.createRange();
    var from = pointAt(blocks[start.b], start.o);
    var to = pointAt(blocks[end.b], end.o);
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    return range;
  }

  /** Range of an anchor with an end ({ b, o, c, eb, eo }), e.g. a quote. */
  function rangeOfAnchor(anchor) {
    var start = resolveAnchor(anchor);
    if (!start) return null;
    var end;
    if (anchor.eb === undefined) {
      end = { b: start.b, o: start.o };
    } else {
      // The end keeps its distance from the start when the start moved.
      var eb = Math.min(blocks.length - 1, start.b + (anchor.eb - anchor.b));
      var eo = anchor.eb === anchor.b ? start.o + (anchor.eo - anchor.o) : anchor.eo;
      end = { b: eb, o: Math.min(eo, blocks[eb].textContent.length) };
    }
    try {
      return rangeBetween(start, end);
    } catch (e) {
      return null;
    }
  }

  function rectAt(point) {
    var el = blocks[point.b];
    var length = el.textContent.length;
    if (length > 0) {
      var range = document.createRange();
      var from = pointAt(el, Math.min(point.o, length - 1));
      var to = pointAt(el, Math.min(point.o, length - 1) + 1);
      try {
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        var rects = range.getClientRects();
        if (rects && rects.length) return rects[0];
      } catch (e) {}
    }
    return el.getBoundingClientRect();
  }

  // ---------------------------------------------------------------- geometry

  function insetTop() {
    return parseFloat(getComputedStyle(root).getPropertyValue('--top')) || 0;
  }

  function pageCount() {
    return Math.max(1, Math.ceil((pager.scrollWidth - 1) / window.innerWidth));
  }

  function setPage(target, animate) {
    var count = pageCount();
    page = Math.max(0, Math.min(count - 1, target));
    var left = page * window.innerWidth;
    if (animate && cfg.animation === 'slide' && pager.scrollTo) {
      pager.scrollTo({ left: left, behavior: 'smooth' });
    } else {
      pager.scrollLeft = left;
    }
    onMoved();
  }

  function maxScroll() {
    return Math.max(0, root.scrollHeight - window.innerHeight);
  }

  function progress() {
    if (isPaged()) {
      var count = pageCount();
      return count > 1 ? page / (count - 1) : 1;
    }
    var max = maxScroll();
    return max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 1;
  }

  /** Anchor of the first character visible at the top of the screen. */
  function topAnchor() {
    if (!blocks.length) return null;
    var margin = parseFloat(getComputedStyle(root).getPropertyValue('--mh')) || 0;
    var x = Math.min(window.innerWidth - 4, margin + 6);
    var y = insetTop() + 6;
    if (document.caretRangeFromPoint) {
      for (var dy = 0; dy < 60; dy += 12) {
        var caret = document.caretRangeFromPoint(x, y + dy);
        var block = caret && blockOf(caret.startContainer);
        if (block) {
          var offset = caret.startContainer.nodeType === 3 ? offsetOf(block, caret.startContainer, caret.startOffset) : 0;
          return makeAnchor(Number(block.getAttribute('data-b')), offset);
        }
      }
    }
    var limit = insetTop();
    for (var i = 0; i < blocks.length; i++) {
      var rect = blocks[i].getBoundingClientRect();
      if (isPaged() ? rect.right > 0 && rect.left >= -1 : rect.bottom > limit) return makeAnchor(i, 0);
    }
    return makeAnchor(blocks.length - 1, 0);
  }

  function scrollToPoint(point, center) {
    var rect = rectAt(point);
    if (isPaged()) {
      setPage(Math.floor((rect.left + pager.scrollLeft + 1) / window.innerWidth), false);
    } else {
      var offset = center ? window.innerHeight * 0.3 : insetTop();
      window.scrollTo(0, Math.max(0, rect.top + window.scrollY - offset));
    }
  }

  function goTo(anchor, center) {
    var point = resolveAnchor(anchor);
    if (point) scrollToPoint(point, center);
    return point;
  }

  function seek(value) {
    if (isPaged()) {
      setPage(Math.round(value * (pageCount() - 1)), false);
    } else {
      window.scrollTo(0, value * maxScroll());
    }
  }

  // ---------------------------------------------------------------- reporting

  function sendProgress() {
    progressTimer = null;
    post('progress', { progress: progress(), page: page, pages: isPaged() ? pageCount() : 0 });
  }

  function sendPosition() {
    if (positionTimer) {
      clearTimeout(positionTimer);
      positionTimer = null;
    }
    if (!blocks.length) return;
    lastSentPosition = Date.now();
    post('position', { progress: progress(), anchor: topAnchor() });
  }

  function activity() {
    var now = Date.now();
    if (now - lastActivity > 5000) {
      lastActivity = now;
      post('activity');
    }
  }

  /**
   * Called whenever the visible part changed. The position is saved at most every
   * 2 seconds while moving, and once more shortly after the movement stops. Nothing is
   * saved before the reader has interacted, so that opening a chapter never overwrites
   * its saved position while the layout settles.
   */
  function onMoved() {
    if (!progressTimer) progressTimer = setTimeout(sendProgress, 200);
    if (!interacted) return;
    if (positionTimer) clearTimeout(positionTimer);
    if (Date.now() - lastSentPosition >= 2000) sendPosition();
    else positionTimer = setTimeout(sendPosition, 600);
  }

  // ---------------------------------------------------------------- highlights

  var highlights = window.CSS && CSS.highlights && window.Highlight ? CSS.highlights : null;

  function setHighlight(name, ranges) {
    if (!highlights) return;
    if (!ranges || !ranges.length) {
      highlights.delete(name);
      return;
    }
    var highlight = new Highlight();
    for (var i = 0; i < ranges.length; i++) highlight.add(ranges[i]);
    highlights.set(name, highlight);
  }

  function setQuotes(list) {
    quotes = [];
    for (var i = 0; i < (list || []).length; i++) {
      var range = rangeOfAnchor(list[i].a);
      if (range && !range.collapsed) quotes.push({ id: list[i].id, range: range });
    }
    setHighlight(
      'quote',
      cfg.showQuotes === false ? [] : quotes.map(function (quote) { return quote.range; })
    );
  }

  function quoteAt(node, offset) {
    for (var i = 0; i < quotes.length; i++) {
      try {
        if (quotes[i].range.isPointInRange(node, offset)) return quotes[i].id;
      } catch (e) {}
    }
    return null;
  }

  function flash(anchor) {
    var range = rangeOfAnchor(anchor);
    if (!range) return;
    if (highlights && !range.collapsed) {
      setHighlight('flash', [range]);
      setTimeout(function () { setHighlight('flash', []); }, 2000);
    } else {
      var el = blockOf(range.startContainer);
      if (!el) return;
      el.classList.add('ln-flash');
      setTimeout(function () { el.classList.remove('ln-flash'); }, 2000);
    }
  }

  // ---------------------------------------------------------------- search

  function fold(text) {
    return text.toLowerCase();
  }

  function runSearch(query) {
    search = { ranges: [], index: -1 };
    var needle = fold(query || '');
    if (needle) {
      for (var b = 0; b < blocks.length; b++) {
        var haystack = fold(blocks[b].textContent);
        var from = 0;
        var at;
        while ((at = haystack.indexOf(needle, from)) !== -1) {
          search.ranges.push({ b: b, o: at, range: rangeBetween({ b: b, o: at }, { b: b, o: at + needle.length }) });
          from = at + needle.length;
        }
      }
    }
    setHighlight('search', search.ranges.map(function (hit) { return hit.range; }));
    if (search.ranges.length) {
      // Start from the first match at or after the current position.
      var top = topAnchor();
      var start = 0;
      if (top) {
        for (var i = 0; i < search.ranges.length; i++) {
          var hit = search.ranges[i];
          if (hit.b > top.b || (hit.b === top.b && hit.o >= top.o)) {
            start = i;
            break;
          }
        }
      }
      showSearchHit(start);
    } else {
      setHighlight('search-current', []);
      post('search', { count: 0, index: -1 });
    }
  }

  function showSearchHit(index) {
    var count = search.ranges.length;
    if (!count) return;
    search.index = ((index % count) + count) % count;
    var hit = search.ranges[search.index];
    setHighlight('search-current', [hit.range]);
    scrollToPoint({ b: hit.b, o: hit.o }, true);
    post('search', { count: count, index: search.index });
  }

  // ---------------------------------------------------------------- selection

  var selectionTimer = null;

  function locate(node, offset) {
    var block = blockOf(node);
    if (block) return { b: Number(block.getAttribute('data-b')), o: offsetOf(block, node, offset) };
    return null;
  }

  function reportSelection() {
    selectionTimer = null;
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      post('selection', { text: '' });
      return;
    }
    var range = selection.getRangeAt(0);
    var text = selection.toString();
    var start = locate(range.startContainer, range.startOffset);
    var end = locate(range.endContainer, range.endOffset);
    if (!start || !end || !text.trim()) {
      post('selection', { text: text, anchor: null });
      return;
    }
    var anchor = makeAnchor(start.b, start.o);
    anchor.eb = end.b;
    anchor.eo = end.o;
    post('selection', { text: text, anchor: anchor });
  }

  document.addEventListener('selectionchange', function () {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(reportSelection, 150);
  });

  // ---------------------------------------------------------------- navigation and taps

  function nextPage() {
    if (isPaged()) {
      if (page >= pageCount() - 1) post('next');
      else setPage(page + 1, true);
    } else if (window.scrollY >= maxScroll() - 2) {
      post('next');
    } else {
      window.scrollBy({ top: window.innerHeight * 0.88, behavior: 'smooth' });
    }
  }

  function previousPage() {
    if (isPaged()) {
      if (page <= 0) post('previous');
      else setPage(page - 1, true);
    } else if (window.scrollY <= 2) {
      post('previous');
    } else {
      window.scrollBy({ top: -window.innerHeight * 0.88, behavior: 'smooth' });
    }
  }

  var touch = null;

  document.addEventListener(
    'touchstart',
    function (event) {
      interacted = true;
      activity();
      if (autoScroll.speed) stopAutoScroll(true);
      var point = event.touches[0];
      touch = { x: point.clientX, y: point.clientY, time: Date.now() };
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    function (event) {
      if (!touch || !isPaged()) return;
      var point = event.changedTouches[0];
      var dx = point.clientX - touch.x;
      var dy = point.clientY - touch.y;
      var selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - touch.time < 800) {
        touch = null;
        if (dx < 0) nextPage();
        else previousPage();
      }
    },
    { passive: true }
  );

  document.addEventListener('click', function (event) {
    var selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    var target = event.target;
    if (target.closest && target.closest('#end')) {
      post('next');
      return;
    }
    var link = target.closest && target.closest('a[href]');
    if (link) {
      event.preventDefault();
      post('link', { href: link.getAttribute('href') });
      return;
    }
    if (quotes.length && document.caretRangeFromPoint) {
      var caret = document.caretRangeFromPoint(event.clientX, event.clientY);
      var id = caret ? quoteAt(caret.startContainer, caret.startOffset) : null;
      if (id !== null) {
        post('quoteTap', { id: id });
        return;
      }
    }
    if (isPaged() && cfg.tapZones !== 'off') {
      var ratio = event.clientX / window.innerWidth;
      var leftIsPrevious = cfg.tapZones !== 'leftNext';
      if (ratio < 0.3) {
        if (leftIsPrevious) previousPage();
        else nextPage();
        return;
      }
      if (ratio > 0.7) {
        if (leftIsPrevious) nextPage();
        else previousPage();
        return;
      }
    }
    post('tap');
  });

  window.addEventListener(
    'scroll',
    function () {
      if (!isPaged()) {
        activity();
        onMoved();
      }
    },
    { passive: true }
  );

  // ---------------------------------------------------------------- automatic scrolling

  function stopAutoScroll(notify) {
    if (autoScroll.raf) cancelAnimationFrame(autoScroll.raf);
    autoScroll = { speed: 0, raf: 0, last: 0, carry: 0 };
    if (notify) post('autoScroll', { running: false });
  }

  function autoScrollStep(now) {
    if (!autoScroll.speed) return;
    var elapsed = autoScroll.last ? Math.min(100, now - autoScroll.last) : 16;
    autoScroll.last = now;
    autoScroll.carry += (autoScroll.speed * elapsed) / 1000;
    var pixels = Math.floor(autoScroll.carry);
    if (pixels > 0) {
      autoScroll.carry -= pixels;
      window.scrollBy(0, pixels);
      activity();
    }
    if (window.scrollY >= maxScroll() - 1) {
      stopAutoScroll(true);
      return;
    }
    autoScroll.raf = requestAnimationFrame(autoScrollStep);
  }

  function startAutoScroll(speed) {
    stopAutoScroll(false);
    if (!speed || isPaged()) return;
    interacted = true;
    autoScroll.speed = speed;
    autoScroll.raf = requestAnimationFrame(autoScrollStep);
    post('autoScroll', { running: true });
  }

  // ---------------------------------------------------------------- settings

  function applySettings(settings) {
    var anchor = topAnchor();
    var vars = settings.vars || {};
    for (var name in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) root.style.setProperty(name, vars[name]);
    }
    if (settings.fontFaces !== undefined) {
      var style = document.getElementById('ln-fonts');
      if (style) style.textContent = settings.fontFaces;
    }
    if (settings.mode) root.classList.toggle('paged', settings.mode === 'paged');
    if (settings.animation) cfg.animation = settings.animation;
    if (settings.tapZones) cfg.tapZones = settings.tapZones;
    if (settings.showQuotes !== undefined) {
      cfg.showQuotes = settings.showQuotes;
      setHighlight('quote', cfg.showQuotes ? quotes.map(function (quote) { return quote.range; }) : []);
    }
    if (settings.mode !== 'paged') {
      pager.scrollLeft = 0;
      page = 0;
    }
    // The layout changed: stay on the same text.
    requestAnimationFrame(function () {
      if (anchor) goTo(anchor, false);
      sendProgress();
    });
  }

  // ---------------------------------------------------------------- commands

  LN.cmd = function (command) {
    switch (command.name) {
      case 'settings':
        applySettings(command);
        break;
      case 'seek':
        interacted = true;
        seek(command.progress);
        break;
      case 'goTo':
        interacted = true;
        goTo(command.anchor, true);
        if (command.flash) flash(command.anchor);
        break;
      case 'next':
        interacted = true;
        nextPage();
        break;
      case 'previous':
        interacted = true;
        previousPage();
        break;
      case 'search':
        runSearch(command.query);
        break;
      case 'searchStep':
        showSearchHit(search.index + command.step);
        break;
      case 'searchClear':
        runSearch('');
        break;
      case 'quotes':
        setQuotes(command.list);
        break;
      case 'autoScroll':
        if (command.speed) startAutoScroll(command.speed);
        else stopAutoScroll(true);
        break;
      case 'clearSelection':
        if (window.getSelection) window.getSelection().removeAllRanges();
        break;
      case 'flush':
        sendPosition();
        break;
      case 'highlight':
        // Sentence being read aloud: { b, start, end } or null.
        if (command.range && blocks[command.range.b]) {
          var spoken = rangeBetween(
            { b: command.range.b, o: command.range.start },
            { b: command.range.b, o: command.range.end }
          );
          setHighlight('spoken', [spoken]);
          var rect = spoken.getBoundingClientRect();
          var visible = isPaged()
            ? rect.left >= 0 && rect.left < window.innerWidth
            : rect.top >= insetTop() && rect.bottom <= window.innerHeight * 0.8;
          if (!visible) scrollToPoint({ b: command.range.b, o: command.range.start }, true);
        } else {
          setHighlight('spoken', []);
        }
        break;
    }
  };

  /** Text of every block, for search in book, reading aloud and editing. */
  LN.blockTexts = function () {
    return blocks.map(function (el) { return el.textContent; });
  };

  // Exposed for the unit tests.
  LN._internals = {
    indexBlocks: indexBlocks,
    makeAnchor: makeAnchor,
    resolveAnchor: resolveAnchor,
    rangeOfAnchor: rangeOfAnchor,
    pointAt: pointAt,
    offsetOf: offsetOf,
    runSearch: runSearch,
    getSearch: function () { return search; },
    setQuotes: setQuotes,
    getQuotes: function () { return quotes; },
    getBlocks: function () { return blocks; }
  };

  // ---------------------------------------------------------------- start

  function restore() {
    if (interacted) return;
    if (cfg.anchor) goTo(cfg.anchor, false);
    else if (cfg.progress > 0 && cfg.progress < 1) seek(cfg.progress);
    else if (isPaged()) setPage(0, false);
  }

  function start() {
    indexBlocks();
    setQuotes(cfg.quotes || []);
    restore();
    if (cfg.flash) {
      goTo(cfg.flash, true);
      flash(cfg.flash);
      interacted = true;
    }
    sendProgress();
    post('ready', { blocks: blocks.length });
    // Images and fonts change the layout once loaded: go back to the saved place.
    window.addEventListener('load', restore);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(restore);
    window.addEventListener('resize', function () {
      var anchor = topAnchor();
      requestAnimationFrame(function () {
        if (anchor) goTo(anchor, false);
      });
    });
  }

  if (content) start();
  void endCard;
})();
`;
