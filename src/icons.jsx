import React from 'react';

// Small line icons (24 x 24, drawn with the text colour).
const I = ({ children, size = 20, ...rest }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>{children}</svg>
);

export const BluetoothIcon = (p) => <I {...p}><path d="M7 7l10 10-5 4V3l5 4L7 17" /></I>;
export const PauseIcon = (p) => <I {...p}><path d="M8 5v14M16 5v14" /></I>;
export const PlayIcon = (p) => <I {...p}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></I>;
export const SnowIcon = (p) => <I {...p}><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5" /></I>;
export const BrainIcon = (p) => <I {...p}><circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="12" r="2.4" /><path d="M7 6.4l9.8 4.6M7 17.6l9.8-4.6M7 6.2v0M7 17.8v0" /></I>;
export const EraserIcon = (p) => <I {...p}><path d="M4 16l9-9 6 6-6 6H8z" /><path d="M13 19h7" /></I>;
export const CloseIcon = (p) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>;
export const PulseIcon = (p) => <I {...p}><path d="M2.5 12.5h4l2.5-6.5 4 12 2.5-5.5h6" /></I>;
export const HelpIcon = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.8-2.5 2.2-2.5 3.9M12 17.2v.1" /></I>;
export const SunIcon = (p) => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.2 5.2l1.6 1.6M17.2 17.2l1.6 1.6M18.8 5.2l-1.6 1.6M6.8 17.2l-1.6 1.6" /></I>;
export const MoonIcon = (p) => <I {...p}><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" /></I>;
export const CheckIcon = (p) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;
export const PlusIcon = (p) => <I {...p}><path d="M12 5v14M5 12h14" /></I>;
export const MinusIcon = (p) => <I {...p}><path d="M5 12h14" /></I>;
export const TrashIcon = (p) => <I {...p}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></I>;
export const ResetIcon = (p) => <I {...p}><path d="M4 12a8 8 0 108-8H8" /><path d="M11 1.5L8 4l3 2.5" /></I>;
export const SaveIcon = (p) => <I {...p}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></I>;
export const FolderIcon = (p) => <I {...p}><path d="M3 7h6l2 2h10v10H3z" /></I>;
export const CopyIcon = (p) => <I {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></I>;
export const DownloadIcon = (p) => <I {...p}><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" /></I>;
export const WarnIcon = (p) => <I {...p}><path d="M12 3.5L2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2v.1" /></I>;
export const ArrowUpIcon = (p) => <I {...p}><path d="M12 19V5M6 11l6-6 6 6" /></I>;
export const ArrowDownIcon = (p) => <I {...p}><path d="M12 5v14M6 13l6 6 6-6" /></I>;
export const FlashIcon = (p) => <I {...p}><path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z" /></I>;
export const EyeIcon = (p) => <I {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></I>;
export const EyeOffIcon = (p) => <I {...p}><path d="M2.5 12S6 5.5 12 5.5c1.7 0 3.2.5 4.5 1.2M21.5 12S18 18.5 12 18.5c-1.7 0-3.2-.5-4.5-1.2" /><path d="M4 4l16 16" /></I>;
export const GearIcon = (p) => <I {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.8l1.6 2.6 3-.7.7 3 2.6 1.6-1.6 2.6 1.6 2.6-2.6 1.6-.7 3-3-.7L12 21.2l-1.6-2.6-3 .7-.7-3-2.6-1.6 1.6-2.6-1.6-2.6 2.6-1.6.7-3 3 .7z" /></I>;
export const TableIcon = (p) => <I {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><path d="M3.5 10h17M3.5 15h17M10 4.5v15" /></I>;
export const ChartIcon = (p) => <I {...p}><path d="M4 19V5M4 19h16M7 15l4-5 3 3 5-7" /></I>;
export const RobotIcon = (p) => <I {...p}><path d="M5 20V9q0-5 7-5t7 5v11z" /><circle cx="9.5" cy="10" r="1.3" /><circle cx="14.5" cy="10" r="1.3" /></I>;
export const CubeIcon = (p) => <I {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></I>;
export const ChevronIcon = (p) => <I {...p}><path d="M9 6l6 6-6 6" /></I>;
export const BatteryIcon = (p) => <I {...p}><rect x="2.5" y="7" width="16" height="10" rx="2" /><path d="M21 10.5v3M6 10.5v3M10 10.5v3" /></I>;
export const StopIcon = (p) => <I {...p}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" /></I>;
export const TargetIcon = (p) => <I {...p}><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></I>;
export const HandIcon = (p) => <I {...p}><path d="M8 12V6.5a1.5 1.5 0 013 0V11M11 11V5a1.5 1.5 0 013 0v6M14 11V6.5a1.5 1.5 0 013 0V13M17 11.5a1.5 1.5 0 013 0V15c0 3.5-2.5 6-6 6h-1c-2.5 0-4-1.2-5.5-3.5L4.5 14a1.5 1.5 0 012.3-1.9L8 13.5" /></I>;
export const RotateIcon = (p) => <I {...p}><path d="M20 12a8 8 0 11-3-6.2M20 4v4.5h-4.5" /></I>;
export const PenIcon = (p) => <I {...p}><path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19z" /><path d="M14.5 6.5l3 3" /></I>;

// The QR code of the page (to show it), the eye in a viewfinder (to scan another one: not a QR code, so that the two buttons are
// told apart), a camera that does not work, a picture, and a die (to draw another pseudonym). Drawn on a 64 x 64 grid.
const B = { viewBox: '0 0 64 64', strokeWidth: 4.5 };
export const QrIcon = (p) => (
  <I {...B} strokeLinejoin="round" {...p}>
    <rect x="7" y="7" width="20" height="20" rx="3" /><rect x="37" y="7" width="20" height="20" rx="3" /><rect x="7" y="37" width="20" height="20" rx="3" />
    <rect x="13" y="13" width="8" height="8" fill="currentColor" stroke="none" /><rect x="43" y="13" width="8" height="8" fill="currentColor" stroke="none" /><rect x="13" y="43" width="8" height="8" fill="currentColor" stroke="none" />
    <path d="M37 40 h7 M50 40 h7 M37 48 v9 M44 47 h6 M54 47 v10 M44 56 h4" />
  </I>
);
export const ScanIcon = (p) => (
  <I {...B} strokeWidth="5" {...p}>
    <path d="M6 22 V12 a6 6 0 0 1 6-6 h10 M42 6 h10 a6 6 0 0 1 6 6 v10 M58 42 v10 a6 6 0 0 1-6 6 H42 M22 58 H12 a6 6 0 0 1-6-6 V42" />
    <path d="M13 32 C 21 21 43 21 51 32 C 43 43 21 43 13 32 Z" strokeWidth="4.5" />
    <circle cx="32" cy="32" r="6.5" fill="currentColor" stroke="none" />
  </I>
);
export const CameraOffIcon = (p) => (
  <I {...B} {...p}>
    <path d="M10 20 h8 l4-6 h20 l4 6 h8 a4 4 0 0 1 4 4 v22 a4 4 0 0 1-4 4 H10 a4 4 0 0 1-4-4 V24 a4 4 0 0 1 4-4z" />
    <circle cx="32" cy="35" r="9" />
    <path d="M8 8 L56 56" stroke="#ef4444" strokeWidth="6" />
  </I>
);
export const ImageIcon = (p) => (
  <I {...B} {...p}>
    <rect x="7" y="10" width="50" height="44" rx="7" /><circle cx="22" cy="25" r="5" fill="currentColor" stroke="none" /><path d="M9 48 L25 33 L35 42 L43 34 L55 46" />
  </I>
);
export const DiceIcon = (p) => (
  <I {...B} strokeLinejoin="round" {...p}>
    <rect x="8" y="8" width="48" height="48" rx="11" />
    <circle cx="22" cy="22" r="3.6" fill="currentColor" stroke="none" /><circle cx="42" cy="22" r="3.6" fill="currentColor" stroke="none" />
    <circle cx="32" cy="32" r="3.6" fill="currentColor" stroke="none" />
    <circle cx="22" cy="42" r="3.6" fill="currentColor" stroke="none" /><circle cx="42" cy="42" r="3.6" fill="currentColor" stroke="none" />
  </I>
);
