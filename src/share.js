// The configuration of the page as a short text, for a QR code, and back. A teacher shows the code, the students scan it and end up with
// the same drawing: the language, the figure, its size, and the form of their own (its points), how many times it is drawn and the angle
// it ends with.
//
//   T3D1;l=fr;p=0;f=16;z=100;r=4;e=0;c=0:50,25:75,50:50,50:0,0:0
//
// The first word names the format and its version (the cards application writes T3C1, the learning one T3L1: their codes are not ours). A
// field is `letter=value`; the order does not matter, a field that is missing leaves that part of the page as it is, and a field that is
// not valid is dropped: what comes from a scan is data, read strictly, never run. `f` is the figure (0..15 the robot's, 16 the form of the
// page's own), `z` the size in percent, `r` the times the form is drawn, `e` the angle it ends with in degrees, `c` the points of the form
// in whole millimetres, x:y, in the robot's frame (its pen at 0:0, facing up, x to its right; the robot's own place on the sheet is not
// carried). `c=` with nothing after it is a form with no point. `p` is the setting "show the pseudonym under the QR code" (1 yes, 0 no): the
// setting travels, the pseudonym itself does not (it is text written on the page of each device).
import { LANGS } from './i18n.js';
import { CUSTOM_ID, SIZE_MIN, SIZE_MAX, REPEAT_MIN, REPEAT_MAX, END_ANGLE_MAX } from './spec.js';
import { MAX_POINTS } from './store.js';

export const PREFIX = 'T3D1';
export const APP_URL = 'https://francescomondada.github.io/thymio3-draw/';   // the demo, for the QR code that opens it on the other screens of a class
// What the QR code of the application can hold, by the browser it should open in. `web`: the plain address, opened by the camera's own choice
// of browser (Chrome or Samsung Internet on Android, both with Web Bluetooth). `ios`: the custom scheme of Bluefy, the browser with Web
// Bluetooth for iPhone and iPad, that must be installed; Bluefy's own documentation does not give the form of its link, so `open?url=` with
// the encoded address is the usual one and the thing to check on an iPad first. There is no code for Chrome on Android: an `intent://` link is
// not opened by the camera of a Samsung (it takes anything that is not a web link for text).
export const APP_LINKS = {
  web: APP_URL,
  ios: `bluefy://open?url=${encodeURIComponent(APP_URL)}`,
};
export const MAX_TEXT = 600;                                   // a longer text is not ours (ours is about 300 characters at most)
export const POINT_MAX = 600;                                  // mm: further than the sheet is

const INT = /^-?\d{1,4}$/;
const int = (s) => (INT.test(s) ? Number(s) : NaN);
const within = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const whole = (v, lo, hi) => clamp(Math.round(Number(v) || 0), lo, hi);

// What the page holds -> the text. `c`: { lang, showName, figure, size, repeat, endAngle, custom: [[x, y], ...] }; a part that is missing is left out.
export function encodeConfig(c) {
  const out = [PREFIX];
  if (LANGS.some((l) => l.id === c.lang)) out.push(`l=${c.lang}`);
  if (c.showName != null) out.push(`p=${c.showName ? 1 : 0}`);
  if (c.figure != null) out.push(`f=${whole(c.figure, 0, CUSTOM_ID)}`);
  if (c.size != null) out.push(`z=${whole(c.size, SIZE_MIN, SIZE_MAX)}`);
  if (c.repeat != null) out.push(`r=${whole(c.repeat, REPEAT_MIN, REPEAT_MAX)}`);
  if (c.endAngle != null) out.push(`e=${whole(c.endAngle, -END_ANGLE_MAX, END_ANGLE_MAX)}`);
  if (Array.isArray(c.custom)) out.push(`c=${c.custom.slice(0, MAX_POINTS).map(([x, y]) => `${whole(x, -POINT_MAX, POINT_MAX)}:${whole(y, -POINT_MAX, POINT_MAX)}`).join(',')}`);
  return out.join(';');
}

// The text of a code -> what it holds, field by field (only the valid ones, in the page's units), or null when it is not one of ours.
export function decodeConfig(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  const [head, ...fields] = text.trim().split(';');
  if (head !== PREFIX) return null;
  const out = {};
  for (const field of fields) {
    const i = field.indexOf('=');
    if (i < 1) continue;
    const key = field.slice(0, i), v = field.slice(i + 1);
    switch (key) {
      case 'l': if (LANGS.some((l) => l.id === v)) out.lang = v; break;
      case 'p': if (v === '1' || v === '0') out.showName = v === '1'; break;
      case 'f': { const n = int(v); if (within(n, 0, CUSTOM_ID)) out.figure = n; break; }
      case 'z': { const n = int(v); if (within(n, SIZE_MIN, SIZE_MAX)) out.size = n; break; }
      case 'r': { const n = int(v); if (within(n, REPEAT_MIN, REPEAT_MAX)) out.repeat = n; break; }
      case 'e': { const n = int(v); if (within(n, -END_ANGLE_MAX, END_ANGLE_MAX)) out.endAngle = n; break; }
      case 'c': {
        const parts = v === '' ? [] : v.split(',');
        const points = parts.map((p) => { const xy = p.split(':').map(int); return xy.length === 2 && xy.every((n) => within(n, -POINT_MAX, POINT_MAX)) ? xy : null; });
        if (parts.length <= MAX_POINTS && points.every(Boolean)) out.custom = points;
        break;
      }
      default: break;                                 // a field of a later version: ignored
    }
  }
  return Object.keys(out).length ? out : null;
}

// A decoded configuration set up in the telemetry store (the page's own memory of the drawing): the form first, so that the figure is
// placed with it; then how many times, the end angle, the size and the figure; then the figure in the middle of the sheet and the robot at
// its start. Returns what the robot is to be told ({ select, size }, for the parts the code held), and nothing is done when the robot is
// drawing (null).
export function applyConfig(store, cfg) {
  if (!cfg || store.s.state !== 'idle') return null;
  if (cfg.custom) store.customSet(cfg.custom);
  if (cfg.repeat != null) store.chooseRepeat(cfg.repeat);
  if (cfg.endAngle != null) store.chooseEndAngle(cfg.endAngle);
  if (cfg.size != null) store.chooseSize(cfg.size);
  if (cfg.figure != null) store.choose(cfg.figure);
  store.centre();
  return { ...(cfg.figure != null ? { select: store.s.sel } : {}), ...(cfg.size != null ? { size: store.s.size } : {}) };
}
