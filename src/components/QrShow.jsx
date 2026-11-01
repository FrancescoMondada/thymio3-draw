import React, { useMemo } from 'react';
import { CloseIcon, WarnIcon } from '../icons.jsx';
import { qrMatrix, qrPath } from '../qr.js';

// The QR code of the configuration, over the whole application and as large as the screen allows, for the other screens of the
// class to scan. A touch anywhere (or Esc) puts it away. With a `caption` ({ name, when }: the pseudonym of the device and the date
// and time) it is written under the code, in the same white card: a code that is photographed to be filed carries whose it is.
export default function QrShow({ text, t, label = t.qr.show, caption, onClose }) {
  const code = useMemo(() => qrMatrix(text), [text]);
  const quiet = 4;
  return (
    <div className={caption ? 'qr-back captioned' : 'qr-back'} role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      {code ? (
        <div className="qr-card">
          <svg className="qr-code" viewBox={`${-quiet} ${-quiet} ${code.size + 2 * quiet} ${code.size + 2 * quiet}`} shapeRendering="crispEdges" role="img" aria-label={label}>
            <rect x={-quiet} y={-quiet} width={code.size + 2 * quiet} height={code.size + 2 * quiet} fill="#fff" />
            <path d={qrPath(code)} fill="#000" />
          </svg>
          {caption && (
            <div className="qr-caption">
              {caption.name && <b>{caption.name}</b>}
              <time>{caption.when}</time>
            </div>
          )}
        </div>
      ) : (
        <div className="qr-problem" role="alert"><WarnIcon /><p>{t.qr.tooBig}</p></div>
      )}
      <button type="button" className="qr-close" onClick={onClose} aria-label={t.qr.close}><CloseIcon /></button>
    </div>
  );
}
