import { formatBytes } from "../lib/image.ts";
import type { Task } from "../lib/types.ts";

type Props = {
  task: Task;
  now: number;
  statusText: string;
  onOpen: () => void;
  onRetry: () => void;
  onRemove: () => void;
};

function elapsedText(task: Task, now: number) {
  if (!task.submittedAt) return "";
  const end = task.finishedAt ?? now;
  const seconds = Math.max(0, Math.round((end - task.submittedAt) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function downloadName(task: Task) {
  const base = task.fileName.replace(/\.[^.]+$/, "");
  return `${base}_${task.resolution}_s${task.scale}.png`;
}

export default function TaskCard({ task, now, statusText, onOpen, onRetry, onRemove }: Props) {
  const busy =
    task.status === "submitting" ||
    task.status === "in_queue" ||
    task.status === "generating";

  return (
    <article className={`card st-${task.status}`}>
      <div className="thumb">
        <img src={task.previewUrl} alt={task.fileName} loading="lazy" />

        <span className={`status ${busy ? "is-busy" : ""}`}>
          {busy && <i className="dot" />}
          {statusText}
          {busy && task.submittedAt ? <b>{elapsedText(task, now)}</b> : null}
        </span>

        {task.status === "done" && (
          <button className="thumb-action" onClick={onOpen}>
            对比查看
          </button>
        )}

        {task.status === "failed" && (
          <div className="thumb-error">
            <span>{task.error || "处理失败"}</span>
            <button className="btn btn-small" onClick={onRetry}>
              重新提交
            </button>
          </div>
        )}
      </div>

      <div className="card-body">
        <div className="card-title" title={task.fileName}>
          {task.fileName}
        </div>
        <div className="card-meta">
          {task.width}×{task.height} · {formatBytes(task.size)}
        </div>
        <div className="card-tags">
          <span className="tag">{task.resolution.toUpperCase()}</span>
          <span className="tag">细节 {task.scale}</span>
          {task.notes.map((note) => (
            <span className="tag tag-warn" key={note}>
              {note}
            </span>
          ))}
        </div>
        <div className="card-actions">
          {task.status === "done" && task.resultUrl ? (
            <>
              <button className="btn btn-ghost btn-small" onClick={onOpen}>
                对比
              </button>
              <a
                className="btn btn-primary btn-small"
                href={task.resultUrl}
                download={downloadName(task)}
              >
                下载 PNG
              </a>
              <button className="btn btn-ghost btn-small" onClick={onRemove}>
                移除
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost btn-small"
              onClick={onRemove}
              disabled={busy}
            >
              移除
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
