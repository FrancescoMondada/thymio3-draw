import React from 'react';
import { BatteryIcon } from '../icons.jsx';

// The real robot's name (it carries its serial number) and its battery, next to the connect button; while the link is being made
// or has been lost, a word for that.
export default function LinkInfo({ t, link, battery }) {
  const connected = link.status === 'connected';
  const text = connected ? link.device || t.real.device : link.status === 'disconnected' || link.status === 'reconnect' ? t.head.lost : t.head.connecting;
  return (
    <span className={`link-info ${link.status}`} role="status" title={connected ? t.real.device : undefined}>
      <i aria-hidden="true" />
      <span className="link-name">{text}</span>
      {connected && battery > 0 && <span className="link-batt" title={t.real.battery}><BatteryIcon size={16} />{battery.toFixed(2)} V</span>}
    </span>
  );
}
