import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";

type Props = {
  onFiles: (files: File[]) => void;
  compact: boolean;
};

function pickImages(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter(
    (file) => file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name),
  );
}

export default function Uploader({ onFiles, compact }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = pickImages(event.clipboardData?.files);
      if (!files.length) return;
      event.preventDefault();
      onFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFiles]);

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const files = pickImages(event.dataTransfer.files);
      if (files.length) onFiles(files);
    },
    [onFiles],
  );

  const openPicker = () => inputRef.current?.click();

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        onChange={(event) => {
          const files = pickImages(event.target.files);
          if (files.length) onFiles(files);
          event.target.value = "";
        }}
      />

      {compact ? (
        <div
          className={`dropbar ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={openPicker}
        >
          <span className="dropbar-plus">＋</span>
          <span>继续添加图片，或直接把图片拖到这里 / 按 ⌘V 粘贴</span>
        </div>
      ) : (
        <div
          className={`dropzone ${dragging ? "is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={openPicker}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") openPicker();
          }}
        >
          <div className="dropzone-icon" aria-hidden>
            ⬆
          </div>
          <h2>拖入图片开始放大</h2>
          <p>或点击选择文件 · 支持 ⌘V 粘贴 · 可一次添加多张</p>
          <div className="dropzone-tags">
            <span>JPEG / PNG</span>
            <span>≤ 4.7MB</span>
            <span>≤ 4096×4096</span>
            <span>宽高比 1:3–3:1</span>
          </div>
        </div>
      )}
    </>
  );
}
