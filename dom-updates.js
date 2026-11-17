'use strict';
// Background updates retain existing controls and decoded images. Navigation
// still creates a new view; metadata and download progress only patch changes.
function contentKey(node) {
  if (node.nodeType !== 1) return '';
  if (node.id) return 'id:' + node.id;
  if (node.dataset.section) return 'section:' + node.dataset.section;
  if (node.dataset.queueKey) return 'queue:' + node.dataset.queueKey;
  if (node.dataset.trackId) return node.tagName + ':' + (node.dataset.list || '') + ':' + node.dataset.trackId;
  if (node.dataset.tid) return 'art:' + node.dataset.tid;
  if (node.dataset.reference) return (node.dataset.type || '') + ':' + node.dataset.id;
  return '';
}
function patchContent(parent, html) {
  const template = document.createElement('template'); template.innerHTML = html;
  reconcileChildren(parent, template.content);
}
function reconcileChildren(parent, source) {
  const previous = [...parent.childNodes], used = new Set(), keyed = new Map();
  for (const node of previous) {
    const key = contentKey(node);
    if (key) { if (!keyed.has(key)) keyed.set(key, []); keyed.get(key).push(node); }
  }
  let cursor = parent.firstChild;
  for (const next of [...source.childNodes]) {
    const key = contentKey(next), sameType = node => node.nodeType === next.nodeType && node.nodeName === next.nodeName;
    let current = key ? keyed.get(key)?.find(node => !used.has(node) && sameType(node))
      : previous.find(node => !used.has(node) && !contentKey(node) && sameType(node));
    if (!current) { current = next.cloneNode(true); parent.insertBefore(current, cursor); }
    else {
      used.add(current);
      if (current !== cursor) parent.insertBefore(current, cursor);
      if (current.nodeType === Node.TEXT_NODE) { if (current.data !== next.data) current.data = next.data; }
      else if (current.nodeType === Node.ELEMENT_NODE) {
        const revealed = current.classList.contains('queue-entry') && current.classList.contains('revealed');
        const swipeClasses = ['song-swiping', 'song-swipe-ready', 'song-swipe-done', 'song-swipe-returning'].filter(name => current.classList.contains(name));
        const swipe = current.style.getPropertyValue('--song-swipe');
        for (const attribute of [...current.attributes]) if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
        for (const attribute of next.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
        if (revealed) current.classList.add('revealed');
        if (swipeClasses.length) { current.classList.add(...swipeClasses); if (swipe) current.style.setProperty('--song-swipe', swipe); }
        if (!(current.dataset.liveContent && !next.childNodes.length)) reconcileChildren(current, next);
      }
    }
    cursor = current.nextSibling;
  }
  for (const node of previous) if (!used.has(node)) node.remove();
}
