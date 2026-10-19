"use client";

// NEXUS OS — application registry. Apps are code-split via next/dynamic
// so boot stays fast; add an entry here + a folder under apps/ to
// install a new application.

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { AppInstanceProps } from "../types";

const loading = () => (
  <div className="grid h-full w-full place-items-center">
    <div
      className="h-6 w-6 rounded-full border-2 border-[rgba(var(--nx-accent-rgb),0.25)] border-t-[var(--nx-accent)] nx-spin"
      aria-label="Loading"
    />
  </div>
);

export const APP_COMPONENTS: Record<string, ComponentType<AppInstanceProps>> = {
  files: dynamic(() => import("./files"), { ssr: false, loading }),
  terminal: dynamic(() => import("./terminal"), { ssr: false, loading }),
  studio: dynamic(() => import("./studio"), { ssr: false, loading }),
  ai: dynamic(() => import("./ai"), { ssr: false, loading }),
  browser: dynamic(() => import("./browser"), { ssr: false, loading }),
  monitor: dynamic(() => import("./monitor"), { ssr: false, loading }),
  notes: dynamic(() => import("./notes"), { ssr: false, loading }),
  calc: dynamic(() => import("./calc"), { ssr: false, loading }),
  tasks: dynamic(() => import("./tasks"), { ssr: false, loading }),
  media: dynamic(() => import("./media"), { ssr: false, loading }),
  images: dynamic(() => import("./images"), { ssr: false, loading }),
  docsview: dynamic(() => import("./docsview"), { ssr: false, loading }),
  pkgmgr: dynamic(() => import("./pkgmgr"), { ssr: false, loading }),
  settings: dynamic(() => import("./settings"), { ssr: false, loading }),
};

export function getApp(id: string): ComponentType<AppInstanceProps> | undefined {
  return APP_COMPONENTS[id];
}
