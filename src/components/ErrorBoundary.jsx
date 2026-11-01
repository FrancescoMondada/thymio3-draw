import React from 'react';

// If something goes wrong, the screen must not just go blank: what happened, and a button that loads the page again.
export default class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }

  static getDerivedStateFromError(error) { return { error }; }

  componentDidCatch(error, info) {
    console.error('[draw] the interface failed', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something broke</h1>
        <p>{String(this.state.error?.message || this.state.error)}</p>
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
