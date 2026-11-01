import React, { useEffect, useRef, useState } from 'react';
import { CameraOffIcon, CheckIcon, CloseIcon, ImageIcon } from '../icons.jsx';
import { readQr } from '../qr.js';

const WIDTH = 960;                       // the frames are looked at at this width at most
const EVERY_MS = 120;
const BAD_AGAIN_MS = 1500;

// Scanning the QR code of another page (the configuration of a teacher or of a classmate): the camera behind a viewfinder, and a photo of the code as another way in
// (a camera that is refused or missing, or a code received as a picture). `onText(text)` tells whether the text was
// accepted; when it was, the scan is over.
export default function QrScan({ t, onText, onClose }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const file = useRef(null);
  const [state, setState] = useState('starting');           // starting | scanning | denied | missing
  const [bad, setBad] = useState(0);                         // a code that is not ours was seen: the frame flashes
  const [found, setFound] = useState(false);
  const last = useRef({ text: '', at: 0 });
  const done = useRef(false);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // A text that was read: accepted, or reported once in a while
  const offer = (text) => {
    if (done.current) return true;
    const now = performance.now();
    if (text === last.current.text && now - last.current.at < BAD_AGAIN_MS) return false;
    if (onTextRef.current(text)) { done.current = true; setFound(true); return true; }
    last.current = { text, at: now };
    setBad((n) => n + 1);
    return false;
  };

  useEffect(() => {
    let alive = true, stream = null, timer = 0;
    const stop = () => { clearTimeout(timer); stream?.getTracks().forEach((tr) => tr.stop()); if (video.current) video.current.srcObject = null; };
    const look = async () => {
      const v = video.current, c = canvas.current;
      if (!alive || done.current) return;
      if (v && c && v.readyState >= 2 && v.videoWidth) {
        const w = Math.min(WIDTH, v.videoWidth), h = Math.round((v.videoHeight * w) / v.videoWidth);
        c.width = w; c.height = h;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(v, 0, 0, w, h);
        try {
          const text = await readQr(g.getImageData(0, 0, w, h));
          if (text && alive) offer(text);
        } catch { /* a frame that cannot be read */ }
      }
      if (alive && !done.current) timer = setTimeout(look, EVERY_MS);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) { setState('missing'); return; }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (!alive) { stop(); return; }
        video.current.srcObject = stream;
        await video.current.play();
        setState('scanning');
        look();
      } catch (e) {
        if (alive) setState(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'denied' : 'missing');
      }
    })();
    return () => { alive = false; stop(); };
  }, []);                                                  // eslint-disable-line react-hooks/exhaustive-deps

  // A photo (or a screenshot) of a code
  const fromPicture = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const bitmap = await createImageBitmap(f);
      const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const c = canvas.current;
      c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0, c.width, c.height);
      const text = await readQr(g.getImageData(0, 0, c.width, c.height));
      if (text) offer(text); else setBad((n) => n + 1);
    } catch { setBad((n) => n + 1); }
  };

  return (
    <div className={`qr-back scan ${state}`} role="dialog" aria-modal="true" aria-label={t.qr.scan}>
      <video ref={video} className="scan-video" playsInline muted autoPlay />
      <canvas ref={canvas} hidden />
      <div className={`scan-frame${found ? ' found' : ''}`} key={bad} data-bad={bad ? 'yes' : 'no'}>
        <i /><i /><i /><i />
        {found && <span className="scan-ok" aria-hidden="true"><CheckIcon /></span>}
      </div>
      {(state === 'denied' || state === 'missing') && (
        <div className="qr-problem" role="alert"><CameraOffIcon /><p>{state === 'denied' ? t.qr.denied : t.qr.noCamera}</p></div>
      )}
      <input ref={file} type="file" accept="image/*" hidden onChange={fromPicture} />
      <button type="button" className="scan-picture" onClick={() => file.current?.click()} aria-label={t.qr.fromImage}><ImageIcon /></button>
      <button type="button" className="qr-close" onClick={onClose} aria-label={t.qr.close}><CloseIcon /></button>
      <p className="sr-only" role="status" aria-live="polite">{found ? t.qr.applied : bad ? t.qr.bad : ''}</p>
    </div>
  );
}
