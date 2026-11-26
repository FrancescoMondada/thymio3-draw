import React, { useEffect } from 'react';
import { CloseIcon } from '../icons.jsx';
import { ModeArt, PickArt, DrawArt, StopArt } from './ManualArt.jsx';

// The manual of the robot on its own (no tablet), for the pupils, like the one of the cards application: the Painter mode of the firmware.
// How to choose the mode, the figure, how to draw, how to stop. Over the whole application, ONE page that fits the screen (no scrolling)
// and can be shown to a class: four drawings, almost no words. Opened from the settings; Esc or the cross puts it away.
function Card({ title, art }) {
  return (
    <section className="m-card">
      <h3>{title}</h3>
      <div className="m-art">{art}</div>
    </section>
  );
}

export default function Manual({ t, onClose }) {
  const m = t.manual;
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="manual-back" role="dialog" aria-modal="true" aria-label={m.title}>
      <div className="manual">
        <header>
          <h2>{m.title}</h2>
          <button type="button" className="manual-close" onClick={onClose} aria-label={m.close}><CloseIcon /></button>
        </header>
        <div className="manual-grid">
          <Card title={m.mode.title} art={<ModeArt labels={m.mode} />} />
          <Card title={m.pick.title} art={<PickArt labels={m.pick} />} />
          <Card title={m.draw.title} art={<DrawArt labels={m.draw} />} />
          <Card title={m.stop.title} art={<StopArt labels={m.stop} />} />
        </div>
      </div>
    </div>
  );
}
