export type Resolution = "4k" | "8k";

export type TaskStatus =
  | "pending"
  | "submitting"
  | "in_queue"
  | "generating"
  | "done"
  | "failed";

export interface Task {
  id: string;
  file: File;
  fileName: string;
  previewUrl: string;
  width: number;
  height: number;
  size: number;
  notes: string[];
  resolution: Resolution;
  scale: number;
  status: TaskStatus;
  taskId?: string;
  resultUrl?: string;
  resultWidth?: number;
  resultHeight?: number;
  error?: string;
  retryable?: boolean;
  submittedAt?: number;
  finishedAt?: number;
  attempts: number;
  nextPollAt: number;
  pollDelay: number;
}

export const isActive = (task: Task) =>
  task.status === "submitting" || task.status === "in_queue" || task.status === "generating";
