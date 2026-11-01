import React from 'react';
import { sideLengthMm } from '../spec.js';
import { figurePath, bounds } from '../geometry.js';

// A figure as a small picture: the path the pen follows, the start marked with a dot. The same geometry as the sheet's.
const cache = new Map();

export function iconData(fig) {
  if (cache.has(fig.id)) return cache.get(fig.id);
  const p = figurePath(fig, { mm: sideLengthMm() });
  const b = bounds(p.points);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const half = size / 2 + size * 0.16;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const data = {
    d: p.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${(-y).toFixed(1)}`).join(''),
    viewBox: `${(cx - half).toFixed(1)} ${(-cy - half).toFixed(1)} ${(2 * half).toFixed(1)} ${(2 * half).toFixed(1)}`,
    start: [p.points[0][0], -p.points[0][1]],
    unit: (2 * half) / 100,
  };
  cache.set(fig.id, data);
  return data;
}

export default function FigureIcon({ fig, size = 56, className = '' }) {
  const { d, viewBox, start, unit } = iconData(fig);
  return (
    <svg className={`figure-icon ${className}`} viewBox={viewBox} width={size} height={size} aria-hidden="true" focusable="false">
      <path d={d} className="fi-path" vectorEffect="non-scaling-stroke" />
      <circle cx={start[0]} cy={start[1]} r={4.2 * unit} className="fi-start" />
    </svg>
  );
}
