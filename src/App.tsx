import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Uploader from "./components/Uploader.tsx";
import SettingsPanel from "./components/SettingsPanel.tsx";
import TaskCard from "./components/TaskCard.tsx";
import CompareView from "./components/CompareView.tsx";
import {
  ApiError,
  createTask,
  fetchHealth,
  pollTask,
  zipTasks,
  type Health,
} from "./lib/api.ts";
import { prepareImage } from "./lib/image.ts";
import { isActive, type Resolution, type Task, type TaskStatus } from "./lib/types.ts";

// 该 req_key 默认只给 1 个并发额度，超了会返回 50430，所以本地排队按 1 张依次提交
const CONCURRENCY = 1;
const POLL_START = 3000;
const POLL_MAX = 10000;
const MAX_RETRY = 3;
const TIMEOUT: Record<Resolution, number> = {
  "4k": 8 * 60 * 1000,
  "8k": 15 * 60 * 1000,
};

const STATUS_TEXT: Record<TaskStatus, string> = {
  pending: "等待中",
  submitting: "提交中",
  in_queue: "排队中",
  generating: "生成中",
  done: "已完成",
  failed: "失败",
};

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [resolution, setResolution] = useState<Resolution>(
    () => (localStorage.getItem("upscale:resolution") as Resolution) || "4k",
  );
  const [scale, setScale] = useState<number>(() => {
    const saved = Number(localStorage.getItem("upscale:scale"));
    return Number.isFinite(saved) ? saved : 50;
  });
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [now, setNow] = useState(Date.now());

  const tasksRef = useRef<Task[]>([]);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem("upscale:resolution", resolution);
  }, [resolution]);

  useEffect(() => {
    localStorage.setItem("upscale:scale", String(scale));
  }, [scale]);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth({ mock: false, hasCredentials: false }));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchTask = useCallback(
    (id: string, patch: Partial<Task> | ((task: Task) => Partial<Task>)) => {
      setTasks((prev) =>
        prev.map((task) =>
          task.id === id
            ? { ...task, ...(typeof patch === "function" ? patch(task) : patch) }
            : task,
        ),
      );
    },
    [],
  );

  const handleTaskError = useCallback(
    (id: string, error: unknown, phase: "submit" | "poll") => {
      const apiError =
        error instanceof ApiError
          ? error
          : // 轮询时的网络抖动不代表任务失败，远端任务仍在跑，继续重试即可
            new ApiError(String(error), phase === "poll");
      const task = tasksRef.current.find((item) => item.id === id);
      if (!task) return;

      const attempts = task.attempts + 1;
      if (apiError.retryable && attempts <= MAX_RETRY) {
        const delay = Math.min(POLL_MAX, Math.round(POLL_START * 1.5 ** attempts));
        patchTask(id, {
          status: phase === "submit" ? "pending" : task.status,
          attempts,
          error: apiError.message,
          nextPollAt: Date.now() + delay,
          pollDelay: delay,
        });
        setNotice(`${apiError.message}，${Math.round(delay / 1000)}s 后重试`);
        return;
      }

      patchTask(id, {
        status: "failed",
        attempts,
        error: apiError.message,
        retryable: apiError.retryable,
        finishedAt: Date.now(),
      });
    },
    [patchTask],
  );

  const submit = useCallback(
    async (task: Task) => {
      if (inFlight.current.has(task.id)) return;
      inFlight.current.add(task.id);
      patchTask(task.id, { status: "submitting", error: undefined });

      try {
        const remote = await createTask(task.file, task.resolution, task.scale);
        patchTask(task.id, {
          status: remote.status === "done" ? "done" : "in_queue",
          taskId: remote.taskId,
          resultUrl: remote.resultUrl,
          submittedAt: Date.now(),
          finishedAt: remote.status === "done" ? Date.now() : undefined,
          pollDelay: POLL_START,
          nextPollAt: Date.now() + 1500,
          error: undefined,
        });
      } catch (error) {
        handleTaskError(task.id, error, "submit");
      } finally {
        inFlight.current.delete(task.id);
      }
    },
    [handleTaskError, patchTask],
  );

  const poll = useCallback(
    async (task: Task) => {
      if (!task.taskId || inFlight.current.has(task.id)) return;
      inFlight.current.add(task.id);
      patchTask(task.id, {
        nextPollAt: Date.now() + task.pollDelay,
        pollDelay: Math.min(POLL_MAX, Math.round(task.pollDelay * 1.5)),
      });

      try {
        const remote = await pollTask(task.taskId);
        if (remote.status === "done") {
          patchTask(task.id, {
            status: "done",
            resultUrl: remote.resultUrl,
            error: undefined,
            finishedAt: Date.now(),
          });
        } else if (remote.status === "failed") {
          patchTask(task.id, {
            status: "failed",
            error: remote.error || "处理失败",
            retryable: remote.retryable,
            finishedAt: Date.now(),
          });
        } else {
          patchTask(task.id, { status: remote.status, error: undefined });
        }
      } catch (error) {
        handleTaskError(task.id, error, "poll");
      } finally {
        inFlight.current.delete(task.id);
      }
    },
    [handleTaskError, patchTask],
  );

  // 队列调度：同时最多 2 个任务在跑，其余排队
  useEffect(() => {
    const timer = window.setInterval(() => {
      const list = tasksRef.current;
      const ts = Date.now();
      const active = list.filter(isActive);

      for (const task of active) {
        if (
          task.submittedAt &&
          task.status !== "submitting" &&
          ts - task.submittedAt > TIMEOUT[task.resolution]
        ) {
          patchTask(task.id, {
            status: "failed",
            error: "处理超时（8K 任务较大，可稍后重试）",
            finishedAt: ts,
          });
        }
      }

      if (active.length < CONCURRENCY) {
        const next = list.find(
          (task) => task.status === "pending" && ts >= task.nextPollAt,
        );
        if (next) void submit(next);
      }

      for (const task of active) {
        if (
          (task.status === "in_queue" || task.status === "generating") &&
          task.taskId &&
          ts >= task.nextPollAt
        ) {
          void poll(task);
        }
      }
    }, 700);

    return () => window.clearInterval(timer);
  }, [patchTask, poll, submit]);

  useEffect(() => {
    if (!tasks.some(isActive)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tasks]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const results = await Promise.allSettled(files.map((file) => prepareImage(file)));
      const created: Task[] = [];
      const failed: string[] = [];

      results.forEach((result) => {
        if (result.status === "rejected") {
          const reason = result.reason;
          failed.push(reason instanceof Error ? reason.message : String(reason));
          return;
        }
        const prepared = result.value;
        created.push({
          id: crypto.randomUUID(),
          file: prepared.file,
          fileName: prepared.file.name,
          previewUrl: URL.createObjectURL(prepared.file),
          width: prepared.width,
          height: prepared.height,
          size: prepared.file.size,
          notes: prepared.notes,
          resolution,
          scale,
          status: "pending",
          attempts: 0,
          nextPollAt: 0,
          pollDelay: POLL_START,
        });
      });

      if (created.length) setTasks((prev) => [...prev, ...created]);
      if (failed.length) setNotice(failed[0]);
    },
    [resolution, scale],
  );

  const retry = useCallback(
    (id: string) => {
      // 已经拿到远端 taskId 的任务只是轮询失败，继续查原任务，避免重复占用并发额度
      patchTask(id, (task) => ({
        status: task.taskId ? "in_queue" : "pending",
        attempts: 0,
        error: undefined,
        retryable: false,
        nextPollAt: 0,
        pollDelay: POLL_START,
        taskId: task.taskId,
        submittedAt: task.taskId ? task.submittedAt : undefined,
        finishedAt: undefined,
      }));
    },
    [patchTask],
  );

  const removeTask = useCallback((id: string) => {
    setTasks((prev) => {
      const target = prev.find((task) => task.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((task) => task.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setTasks((prev) => {
      prev.forEach((task) => URL.revokeObjectURL(task.previewUrl));
      return [];
    });
  }, []);

  const doneTasks = useMemo(
    () => tasks.filter((task) => task.status === "done" && task.resultUrl),
    [tasks],
  );

  const downloadZip = useCallback(async () => {
    if (!doneTasks.length) return;
    setZipping(true);
    try {
      const blob = await zipTasks(doneTasks.map((task) => task.taskId!));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `jimeng_upscale_${Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "打包失败");
    } finally {
      setZipping(false);
    }
  }, [doneTasks]);

  const activeCount = tasks.filter(isActive).length;
  const previewTask = tasks.find((task) => task.id === previewId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden />
          <div>
            <h1>智能超清</h1>
            <p>即梦图像放大工作台 · 4K / 8K · 细节可调</p>
          </div>
        </div>
        <div className="topbar-right">
          {health && (
            <span className={`chip ${health.mock ? "chip-warn" : "chip-ok"}`}>
              {health.mock ? "Mock 模式" : "AK/SK 已配置"}
            </span>
          )}
          <span className="chip">
            并发 {Math.min(activeCount, CONCURRENCY)}/{CONCURRENCY}
          </span>
        </div>
      </header>

      <SettingsPanel
        resolution={resolution}
        scale={scale}
        onResolutionChange={(next) => {
          setResolution(next);
          setTasks((prev) =>
            prev.map((task) =>
              task.status === "pending" ? { ...task, resolution: next } : task,
            ),
          );
        }}
        onScaleChange={(next) => {
          setScale(next);
          setTasks((prev) =>
            prev.map((task) =>
              task.status === "pending" ? { ...task, scale: next } : task,
            ),
          );
        }}
      />

      <main className="main">
        <Uploader onFiles={addFiles} compact={tasks.length > 0} />

        {tasks.length > 0 && (
          <div className="toolbar">
            <span className="muted">
              共 {tasks.length} 张 · 已完成 {doneTasks.length} 张
            </span>
            <div className="toolbar-actions">
              <button
                className="btn btn-ghost"
                onClick={clearAll}
                disabled={activeCount > 0}
              >
                清空列表
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void downloadZip()}
                disabled={!doneTasks.length || zipping}
              >
                {zipping ? "打包中…" : `打包下载（${doneTasks.length}）`}
              </button>
            </div>
          </div>
        )}

        <section className="grid">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              now={now}
              statusText={STATUS_TEXT[task.status]}
              onOpen={() => setPreviewId(task.id)}
              onRetry={() => retry(task.id)}
              onRemove={() => removeTask(task.id)}
            />
          ))}
        </section>

        {tasks.length === 0 && (
          <p className="hint">
            支持一次拖入多张图片；单张上限 4.7MB、4096×4096，超出会自动压缩并提示。
          </p>
        )}
      </main>

      {previewTask && previewTask.resultUrl && (
        <CompareView task={previewTask} onClose={() => setPreviewId(null)} />
      )}

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
