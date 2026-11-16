import { useEffect, useRef, useState } from "react";
import type { Task } from "../lib/types.ts";

type Props = {
  task: Task;
  onClose: () => void;
};

export default function CompareView({ task, onClose }: Props) {
  const [pos, setPos] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [resultSize, setResultSize] = useState<{ w: number; h: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<
    | { mode: "slider" }
    | { mode: "pan"; startX: number; startY: number; ox: number; oy: number }
    | null
  >(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useEffect(() => {
    if (zoom === 1) setOffset({ x: 0, y: 0 });
  }, [zoom]);

  const moveSplit = (clientX: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  const clampOffset = (x: number, y: number, scale: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x, y };
    const maxX = ((scale - 1) * rect.width) / 2;
    const maxY = ((scale - 1) * rect.height) / 2;
    return {
      x: Math.min(maxX, Math.max(-maxX, x)),
      y: Math.min(maxY, Math.max(-maxY, y)),
    };
  };

  const downloadName = `${task.fileName.replace(/\.[^.]+$/, "")}_${task.resolution}_s${task.scale}.png`;

  return (
    <div className="cmp-overlay" onClick={onClose}>
      <div className="cmp" onClick={(event) => event.stopPropagation()}>
        <header className="cmp-head">
          <div>
            <strong>{task.fileName}</strong>
            <span>
              {task.resolution.toUpperCase()} · 细节 {task.scale}
            </span>
          </div>
          <div className="cmp-head-actions">
            <a className="btn btn-primary btn-small" href={task.resultUrl} download={downloadName}>
              下载 PNG
            </a>
            <button className="btn btn-ghost btn-small" onClick={onClose}>
              关闭
            </button>
          </div>
        </header>

        <div
          ref={stageRef}
          className={`cmp-stage ${zoom > 1 ? "is-zoomed" : ""}`}
          onPointerDown={(event) => {
            const target = event.target as HTMLElement;
            const onHandle = Boolean(target.closest(".cmp-handle"));
            if (onHandle || zoom === 1) {
              dragRef.current = { mode: "slider" };
              moveSplit(event.clientX);
            } else {
              dragRef.current = {
                mode: "pan",
                startX: event.clientX,
                startY: event.clientY,
                ox: offset.x,
                oy: offset.y,
              };
            }
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag) return;
            if (drag.mode === "slider") {
              moveSplit(event.clientX);
            } else {
              setOffset(
                clampOffset(
                  drag.ox + (event.clientX - drag.startX),
                  drag.oy + (event.clientY - drag.startY),
                  zoom,
                ),
              );
            }
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onWheel={(event) => {
            event.preventDefault();
            setZoom((prev) => Math.min(5, Math.max(1, prev + (event.deltaY < 0 ? 0.25 : -0.25))));
          }}
        >
          <div
            className="cmp-inner"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            <img className="cmp-img" src={task.previewUrl} alt="原图" draggable={false} />
            <div className="cmp-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
              <img
                className="cmp-img"
                src={task.resultUrl}
                alt="放大结果"
                draggable={false}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  setResultSize({ w: img.naturalWidth, h: img.naturalHeight });
                }}
              />
            </div>
          </div>

          <div className="cmp-handle" style={{ left: `${pos}%` }}>
            <span />
          </div>

          <span className="cmp-label cmp-label-left">
            原图 {task.width}×{task.height}
          </span>
          <span className="cmp-label cmp-label-right">
            结果 {resultSize ? `${resultSize.w}×${resultSize.h}` : task.resolution.toUpperCase()}
          </span>
        </div>

        <footer className="cmp-foot">
          <span>拖动分界线对比 · 滚轮缩放（{Math.round(zoom * 100)}%）{zoom > 1 ? " · 拖拽平移" : ""}</span>
          <button
            className="btn btn-ghost btn-small"
            onClick={() => {
              setZoom(1);
              setOffset({ x: 0, y: 0 });
              setPos(50);
            }}
          >
            重置视图
          </button>
        </footer>
      </div>
    </div>
  );
}
