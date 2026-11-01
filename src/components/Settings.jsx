import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon, CopyIcon, DownloadIcon, DiceIcon, QrIcon } from '../icons.jsx';
import { APP_URL } from '../share.js';
import { NAME_MAX } from '../names.js';
import { LANGS } from '../i18n.js';
import { SOURCE_TEXT } from '../script.js';

// The settings, from the gear at the top left: the language (Italian, French, German, English), the theme, and what used to be the
// link diagnostics, for the adult next to the screen: the robot, the journal of the link (what went between the page and the robot),
// a test of the link, the Python that runs on the robot, the keys.
export default function Settings({ t, onShowLink, lang, onLang, theme, onTheme, link, battery, running, lastError, name, onName, onNewName, showName, onShowName, log, onClearLog, onTest, testing, canTest, onClose, bluetooth }) {
  const [copied, setCopied] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const logBox = useRef(null);
  const logText = useMemo(() => {
    const t0 = log.length ? log[0].at : 0;
    const mark = { in: '⇦', out: '⇨', err: '✖', info: '·' };
    return log.map((l) => `+${((l.at - t0) / 1000).toFixed(2).padStart(7)}s ${mark[l.kind] || '·'} ${l.text}`).join('\n');
  }, [log]);
  useEffect(() => { if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight; }, [logText]);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const copy = async (text, set) => {
    try { await navigator.clipboard.writeText(text); set(true); setTimeout(() => set(false), 1500); } catch { /* clipboard blocked */ }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([SOURCE_TEXT], { type: 'text/x-python' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'thymio3_drawer_mode.py' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={t.diag.title}>
        <header className="modal-head">
          <h2>{t.diag.title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t.diag.close}><CloseIcon /></button>
        </header>

        {!bluetooth && <p className="warn" role="alert">{t.head.noBluetooth}</p>}

        <div className="rows">
          <div className="row">
            <span className="row-label">{t.qr.linkRow}</span>
            <div className="btn-row tight link-buttons">
              <button type="button" className="btn small" onClick={() => onShowLink('web')}><QrIcon size={18} />{t.qr.linkButton}</button>
              <button type="button" className="btn small" onClick={() => onShowLink('ios')}><QrIcon size={18} />{t.qr.linkIos}</button>
            </div>
          </div>
        </div>
        <p className="muted small">{t.qr.linkHint} <a className="app-link" href={APP_URL} target="_blank" rel="noopener noreferrer">{APP_URL.replace(/^https:\/\//, '')}</a></p>

        <div className="rows">
          <div className="row">
            <span className="row-label">{t.diag.language}</span>
            <div className="chips">{LANGS.map((l) => <button key={l.id} type="button" className="chip-btn" lang={l.id} aria-pressed={lang === l.id} onClick={() => onLang(l.id)}>{l.label}</button>)}</div>
          </div>
          <div className="row">
            <span className="row-label">{t.diag.theme}</span>
            <div className="seg">
              {[['auto', 'Auto'], ['light', t.head.themeLight], ['dark', t.head.themeDark]].map(([id, label]) => <button key={id} type="button" className={theme === id ? 'on' : ''} aria-pressed={theme === id} onClick={() => onTheme(id)}>{label}</button>)}
            </div>
          </div>
        </div>

        <div className="rows">
          <div className="row">
            <label className="row-label" htmlFor="pseudo">{t.qr.nameRow}</label>
            <div className="name-field">
              <input id="pseudo" type="text" value={name} maxLength={NAME_MAX} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label={t.qr.nameField} onChange={(e) => onName(e.target.value)} />
              <button type="button" className="icon-btn" onClick={onNewName} aria-label={t.qr.nameDraw} title={t.qr.nameDraw}><DiceIcon /></button>
            </div>
          </div>
          <div className="row">
            <span className="row-label" id="show-name-label">{t.qr.nameShow}</span>
            <div className="seg" role="group" aria-labelledby="show-name-label">
              <button type="button" className={showName ? 'on' : ''} aria-pressed={showName} onClick={() => onShowName(true)}>{t.qr.yes}</button>
              <button type="button" className={!showName ? 'on' : ''} aria-pressed={!showName} onClick={() => onShowName(false)}>{t.qr.no}</button>
            </div>
          </div>
        </div>
        <p className="muted small">{t.qr.nameHint}</p>
        <p className="muted small">{t.qr.holds}</p>

        <h3>{t.diag.robot}</h3>
        <dl className="facts">
          <dt>{t.diag.device}</dt><dd>{link.device || '—'}</dd>
          {link.firmware && <><dt>{t.diag.firmware}</dt><dd>{typeof link.firmware === 'string' ? link.firmware : JSON.stringify(link.firmware)}</dd></>}
          {battery ? <><dt>{t.diag.battery}</dt><dd>{battery.toFixed(2)} V</dd></> : null}
          <dt>{t.diag.mode}</dt><dd>{running ? t.diag.modeUp : t.diag.modeDown}</dd>
        </dl>
        <p className="muted small">{t.real.hint}</p>
        <p className="muted small">{t.real.live}</p>
        <p className="muted small">{t.real.buttons}</p>
        {lastError && <p className="warn"><b>{t.diag.lastError}</b><br />{lastError}</p>}

        <h3>{t.diag.log}</h3>
        <p className="muted small">{t.diag.logHint}</p>
        <div className="btn-row tight">
          <button type="button" className="btn small" onClick={onTest} disabled={!canTest || testing}>{testing ? t.diag.testing : t.diag.test}</button>
          <button type="button" className="btn small" onClick={() => copy(logText, setLogCopied)} disabled={!log.length}><CopyIcon size={15} />{logCopied ? t.diag.copied : t.diag.logCopy}</button>
          <button type="button" className="btn small" onClick={onClearLog} disabled={!log.length}>{t.diag.logClear}</button>
        </div>
        {canTest && <p className="muted small">{t.diag.testHint}</p>}
        <pre className="code log" ref={logBox} tabIndex={0}>{logText || t.diag.logEmpty}</pre>

        <h3>{t.diag.script}</h3>
        <p className="muted small">{t.diag.scriptHint}</p>
        <div className="btn-row tight">
          <button type="button" className="btn small" onClick={() => setShowScript((v) => !v)}>{showScript ? t.diag.hide : t.diag.show} drawer_mode.py</button>
          {showScript && <button type="button" className="btn small" onClick={() => copy(SOURCE_TEXT, setCopied)}><CopyIcon size={15} />{copied ? t.diag.copied : t.diag.copy}</button>}
          {showScript && <button type="button" className="btn small" onClick={download}><DownloadIcon size={15} />{t.diag.download}</button>}
        </div>
        {showScript && <pre className="code" tabIndex={0}>{SOURCE_TEXT}</pre>}

        <h3>{t.diag.keys}</h3>
        <dl className="keys">
          {t.diag.shortcuts.map(([k, what]) => <React.Fragment key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></React.Fragment>)}
        </dl>
        <p className="muted small about">{t.diag.about}</p>
      </section>
    </div>
  );
}
