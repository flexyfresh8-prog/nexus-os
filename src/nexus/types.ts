// NEXUS OS — core shared types

export type FSNodeType = "file" | "dir";

export interface FSNode {
  id: string;
  name: string;
  type: FSNodeType;
  parentId: string | null;
  /** UTF-8 text content for text files */
  content?: string;
  /** Binary payload for imported media files */
  binary?: ArrayBuffer;
  mime?: string;
  created: number;
  modified: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SnapZone =
  | "left"
  | "right"
  | "top"
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | null;

export interface WindowState extends Rect {
  id: string;
  appId: string;
  title: string;
  minimized: boolean;
  maximized: boolean;
  zIndex: number;
  props?: Record<string, unknown>;
  prevRect?: Rect;
  closing?: boolean;
  launchedAt: number;
}

/** Metadata for an application (no React imports — safe for stores) */
export interface AppMeta {
  id: string;
  name: string;
  tagline: string;
  keywords: string[];
  /** Tailwind gradient classes for the icon tile */
  gradient: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  singleton?: boolean;
  inDock: boolean;
  desktopShortcut?: boolean;
}

/** Props passed to every running application instance */
export interface AppInstanceProps {
  windowId: string;
  launchProps?: Record<string, unknown>;
  setTitle: (title: string) => void;
  close: () => void;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  ts: number;
  read?: boolean;
  appId?: string;
}

export type DesktopIconKind = "app" | "file";

export interface DesktopIcon {
  id: string;
  kind: DesktopIconKind;
  /** appId (kind=app) or fs node id (kind=file) */
  ref: string;
  gx: number; // grid column
  gy: number; // grid row
}

export interface ContextMenuItem {
  label?: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  shortcut?: string;
  onClick?: () => void;
}

export interface Bookmark {
  id: string;
  title: string;
  url: string;
}
