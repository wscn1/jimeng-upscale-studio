import fs from "node:fs";
import path from "node:path";

export type TaskStatus = "in_queue" | "generating" | "done" | "failed";

export type TaskRecord = {
  taskId: string;
  fileName: string;
  resolution: "4k" | "8k";
  scale: number;
  status: TaskStatus;
  submittedAt: number;
  updatedAt: number;
  mock: boolean;
  resultFile?: string;
  error?: string;
  retryable?: boolean;
};

const DATA_DIR = path.resolve(process.cwd(), ".data");
const RESULT_DIR = path.join(DATA_DIR, "results");
const INDEX_FILE = path.join(DATA_DIR, "tasks.json");

let cache: Record<string, TaskRecord> | null = null;

function ensureDirs() {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
}

function load(): Record<string, TaskRecord> {
  if (cache) return cache;
  ensureDirs();
  try {
    cache = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache as Record<string, TaskRecord>;
}

function persist() {
  ensureDirs();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(load(), null, 2));
}

export function getTaskRecord(taskId: string): TaskRecord | undefined {
  return load()[taskId];
}

export function putTaskRecord(record: TaskRecord) {
  record.updatedAt = Date.now();
  load()[record.taskId] = record;
  persist();
}

export function patchTaskRecord(
  taskId: string,
  patch: Partial<Omit<TaskRecord, "taskId">>,
): TaskRecord {
  const record = load()[taskId];
  if (!record) throw new Error(`任务不存在: ${taskId}`);
  Object.assign(record, patch, { updatedAt: Date.now() });
  persist();
  return record;
}

/** 结果落盘，文件名只保留 basename，避免路径穿越 */
export function saveResult(taskId: string, data: Buffer, ext: string): string {
  ensureDirs();
  const safeName = `${taskId.replace(/[^\w.-]/g, "_")}.${ext.replace(/[^\w]/g, "")}`;
  fs.writeFileSync(path.join(RESULT_DIR, safeName), data);
  return safeName;
}

export function resultPath(fileName: string): string {
  return path.join(RESULT_DIR, path.basename(fileName));
}

export function resultExists(fileName: string): boolean {
  try {
    return fs.statSync(resultPath(fileName)).isFile();
  } catch {
    return false;
  }
}

export const paths = { DATA_DIR, RESULT_DIR, INDEX_FILE };
