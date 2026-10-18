// NEXUS OS — Nexus AI: local types (UI messages, tool steps, task records)

export type ToolStepStatus =
  | "running"
  | "awaiting-approval"
  | "done"
  | "denied"
  | "error";

export interface ToolStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStepStatus;
  summary?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  text: string;
  ts: number;
  /** numbered plan rendered as a plan card */
  plan?: string[];
  /** live tool-call cards attached to an assistant turn */
  toolSteps?: ToolStep[];
  /** error bubbles offer a Retry button */
  retryable?: boolean;
}

export interface HistoryStep {
  name: string;
  status: string;
  summary?: string;
  error?: string;
}

export interface TranscriptMessage {
  role: "user" | "assistant" | "error";
  text: string;
}

export type TaskStatus =
  | "completed"
  | "failed"
  | "stopped"
  | "awaiting-approval";

export interface TaskRecord {
  id: string;
  task: string;
  ts: number;
  status: TaskStatus;
  /** final assistant text, sliced to 200 chars */
  summary: string;
  steps: HistoryStep[];
  /** read-only replay, capped at 40 messages */
  transcript: TranscriptMessage[];
}
