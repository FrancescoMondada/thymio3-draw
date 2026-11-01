// Pure helpers around the robot script: no Vite-only imports, so Node can test them.

// The script is uploaded over Bluetooth: drop what the interpreter ignores.
// Lines that contain a quote keep their trailing comment (a '#' might be inside a string).
// Indentation goes from 4 spaces to 1 per level; the continuation lines of a bracket may have
// any indentation, so only whole groups of 4 leading spaces are touched.
export function minify(src) {
  const out = [];
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const body = /["']/.test(line) ? line : line.replace(/\s+#.*$/, '');
    out.push(body.replace(/^( {4})+/, (m) => ' '.repeat(m.length / 4)));
  }
  return out.join('\n') + '\n';
}

// The mode as a module for the robot's file system. Uploading it takes a few seconds, so it is done once (the name
// carries a hash of the content, see moduleNameFor).
export const buildModuleFrom = (source) => minify(source);

// 32-bit FNV-1a, in hex.
export function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// "draw_1a2b3c4d": a file name of the robot is at most 30 bytes with its ".py".
export const MODULE_PREFIX = 'draw_';
export const moduleNameFor = (moduleText) => `${MODULE_PREFIX}${hash32(moduleText)}`;
