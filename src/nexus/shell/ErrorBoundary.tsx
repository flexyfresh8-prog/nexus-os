"use client";

// NEXUS OS — per-window error isolation: one crashed app never
// takes down the desktop. Offers restart / close recovery actions.

import React from "react";

interface Props {
  appName: string;
  onClose: () => void;
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  restartKey: number;
}

export class AppErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, restartKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[NEXUS] ${this.props.appName} crashed:`, error);
  }

  restart = () => {
    this.setState((s) => ({ error: null, restartKey: s.restartKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-red-500/15 text-2xl">⚠</div>
          <div>
            <div className="text-sm font-semibold text-[var(--nx-text)]">{this.props.appName} hit an error</div>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--nx-text-dim)]">
              {this.state.error.message || "An unexpected error occurred inside this application."} The rest of
              the desktop is unaffected.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={this.restart}
              className="rounded-lg border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.12)] px-4 py-1.5 text-xs font-medium text-[var(--nx-accent)] hover:bg-[rgba(var(--nx-accent-rgb),0.2)] transition"
            >
              Restart app
            </button>
            <button
              onClick={this.props.onClose}
              className="rounded-lg border border-[var(--nx-border)] px-4 py-1.5 text-xs text-[var(--nx-text-dim)] hover:bg-white/5 transition"
            >
              Close window
            </button>
          </div>
        </div>
      );
    }
    return <React.Fragment key={this.state.restartKey}>{this.props.children}</React.Fragment>;
  }
}

export class DesktopErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-[#07080b] text-center">
          <div className="max-w-md p-8">
            <div className="text-4xl font-bold tracking-tight text-[#e8eaf1]">NEXUS OS</div>
            <p className="mt-3 text-sm leading-relaxed text-[#9aa3b2]">
              A critical error interrupted the desktop: {this.state.error.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 rounded-xl bg-[#22d3ee] px-5 py-2 text-sm font-semibold text-black hover:brightness-110 transition"
            >
              Reload system
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
