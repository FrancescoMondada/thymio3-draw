// QR codes: the modules of a code for a text (qrcode-generator), and the text of a code in an image (jsQR). Both are in the
// application itself, not fetched when a code is first scanned: scanning has to work in a classroom whose network comes
// and goes once the page is open.
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

// { size, dark(row, col) } for a text (error correction level M: a screen, a camera, some glare), or null when the
// text does not fit the largest code. The text is ASCII (qrcode-generator writes one byte per character).
export function qrMatrix(text) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    return { size: qr.getModuleCount(), dark: (r, c) => qr.isDark(r, c) };
  } catch {
    return null;
  }
}

// The matrix as one SVG path (a run of dark modules in a row is one rectangle), in modules.
export function qrPath({ size, dark }) {
  let d = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!dark(r, c)) { c++; continue; }
      let n = 1;
      while (c + n < size && dark(r, c + n)) n++;
      d += `M${c} ${r}h${n}v1h-${n}z`;
      c += n;
    }
  }
  return d;
}

// The text of the first QR code found in an image ({ data, width, height }, RGBA as ImageData), or null.
export async function readQr(image) {
  const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
  return found && found.data ? found.data : null;
}
