import type { Resolution } from "./types";

export class ApiError extends Error {
  code?: number;
  retryable: boolean;

  constructor(message: string, retryable: boolean, code?: number) {
    super(message);
    this.retryable = retryable;
    this.code = code;
  }
}

export interface RemoteTask {
  taskId: string;
  status: "in_queue" | "generating" | "done" | "failed";
  resultUrl?: string;
  error?: string;
  retryable?: boolean;
  elapsedMs: number;
  mock: boolean;
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`服务返回异常（HTTP ${res.status}）`, true);
  }
}

function throwFor(data: any, status: number): never {
  throw new ApiError(
    data?.error || `请求失败（HTTP ${status}）`,
    Boolean(data?.retryable),
    data?.code,
  );
}

async function request(input: RequestInfo, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new ApiError("网络异常，无法连接本地服务", true);
  }
  const data = await readJson(res);
  if (!res.ok) throwFor(data, res.status);
  return data;
}

export function createTask(file: File, resolution: Resolution, scale: number) {
  const form = new FormData();
  form.append("file", file);
  form.append("resolution", resolution);
  form.append("scale", String(scale));
  return request("/api/tasks", { method: "POST", body: form }) as Promise<RemoteTask>;
}

export function pollTask(taskId: string) {
  return request(`/api/tasks/${encodeURIComponent(taskId)}`) as Promise<RemoteTask>;
}

export async function zipTasks(taskIds: string[]) {
  let res: Response;
  try {
    res = await fetch("/api/zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    });
  } catch {
    throw new ApiError("网络异常，无法连接本地服务", true);
  }
  if (!res.ok) throwFor(await readJson(res), res.status);
  return res.blob();
}

export interface Health {
  mock: boolean;
  hasCredentials: boolean;
}

export function fetchHealth() {
  return request("/api/health") as Promise<Health>;
}
