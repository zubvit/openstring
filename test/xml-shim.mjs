// A tiny XML parser exposing just the slice of the DOM that musicxml.js uses.
// Test-only: it exists so the import logic can be unit tested without pulling in
// a dependency. The real path uses the browser's DOMParser, which is also
// exercised separately in a browser check - this shim is not the last word.

class El {
  constructor(tag) {
    this.tagName = tag;
    this.attrs = new Map();
    this.children = [];
    this.text = '';
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  get textContent() {
    if (this.children.length === 0) return this.text;
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  getElementsByTagName(tag) {
    const out = [];
    const walk = (el) => {
      for (const c of el.children) {
        if (tag === '*' || c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

function parse(src) {
  const root = new El('#document');
  const stack = [root];
  // Strip declaration, doctype and comments.
  const s = src.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<\/?([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const [full, tag, attrStr, selfClose, textRun] = m;
    if (textRun !== undefined) {
      const t = textRun.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      stack[stack.length - 1].text += t;
      continue;
    }
    if (full.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new El(tag);
    if (attrStr) {
      const ar = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = ar.exec(attrStr)) !== null) el.attrs.set(a[1], a[2]);
    }
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

export class ShimDOMParser {
  parseFromString(src) {
    try {
      return parse(src);
    } catch {
      const bad = new El('#document');
      bad.children.push(new El('parsererror'));
      return bad;
    }
  }
}
