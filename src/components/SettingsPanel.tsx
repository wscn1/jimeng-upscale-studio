import type { CSSProperties } from "react";
import type { Resolution } from "../lib/types";

type Props = {
  resolution: Resolution;
  scale: number;
  onResolutionChange: (next: Resolution) => void;
  onScaleChange: (next: number) => void;
};

const PRESETS = [
  { label: "保真", value: 25 },
  { label: "均衡", value: 50 },
  { label: "增强", value: 75 },
];

export default function SettingsPanel({
  resolution,
  scale,
  onResolutionChange,
  onScaleChange,
}: Props) {
  return (
    <section className="settings">
      <div className="setting-block">
        <div className="setting-label">
          <span>输出尺寸</span>
          <em>固定 4K / 8K 两档</em>
        </div>
        <div className="segment">
          {(["4k", "8k"] as Resolution[]).map((value) => (
            <button
              key={value}
              className={`segment-item ${resolution === value ? "is-active" : ""}`}
              onClick={() => onResolutionChange(value)}
            >
              <strong>{value.toUpperCase()}</strong>
              <small>{value === "4k" ? "约 3840 长边" : "约 7680 长边"}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="setting-block setting-block-wide">
        <div className="setting-label">
          <span>细节程度</span>
          <em>越高纹理越锐利，也越可能被重新生成</em>
        </div>
        <div className="slider-row">
          <input
            className="slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={scale}
            onChange={(event) => onScaleChange(Number(event.target.value))}
            style={{ "--fill": `${scale}%` } as CSSProperties}
          />
          <input
            className="number"
            type="number"
            min={0}
            max={100}
            value={scale}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) {
                onScaleChange(Math.min(100, Math.max(0, Math.round(next))));
              }
            }}
          />
        </div>
        <div className="preset-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={`preset ${scale === preset.value ? "is-active" : ""}`}
              onClick={() => onScaleChange(preset.value)}
            >
              {preset.label}
              <span>{preset.value}</span>
            </button>
          ))}
          {scale > 70 && <span className="preset-warn">细节偏高，人物/文字可能被改写</span>}
        </div>
      </div>
    </section>
  );
}
