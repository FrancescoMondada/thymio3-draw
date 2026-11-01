import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export const MINUS = '−';
const clean = (v) => (Object.is(v, -0) ? 0 : v);

// A number for the screen: one decimal at most, a real minus sign, no useless zeros.
export function num(v, digits = 1) {
  const x = clean(Number(v) || 0);
  const s = Math.abs(x).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return (x < 0 && s !== '0' ? MINUS : '') + s;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The size of an element, kept up to date.
export function useSize(initial = { width: 600, height: 300 }) {
  // a callback ref: the box may leave the page and come back, and the new box has to be measured
  const [el, setEl] = useState(null);
  const [size, setSize] = useState(initial);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;                       // not on screen: keep the last size
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size];
}

// Whether a media query matches, kept up to date.
export function useMedia(query) {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const change = () => setOn(mq.matches);
    change();
    mq.addEventListener?.('change', change);
    return () => mq.removeEventListener?.('change', change);
  }, [query]);
  return on;
}

// A value that stays what the person set while they are changing it, and goes back to the robot's after `holdMs` of quiet.
export function useHeld(value, holdMs = 700) {
  const [held, setHeld] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const hold = (v) => {
    setHeld({ v });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHeld(null), holdMs);
  };
  return [held ? held.v : value, hold];
}
