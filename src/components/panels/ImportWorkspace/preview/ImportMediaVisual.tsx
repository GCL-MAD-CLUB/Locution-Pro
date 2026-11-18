import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { Captions, FileAudio2, FileVideo2, Image } from "lucide-react";
import { useRef, useState } from "react";
import { ImportFolderIcon } from "../browser/ImportFolderIcon";
import { mediaKind, type ImportEntry, type ImportMetadata } from "../browser/importBrowserModel";
import { importCover, importFrame, importMetadata, queuePreview } from "./importPreview";
import { captureOperationError } from "../../../../errors";
import { createLatestPreview, previewTimeUs } from "../../../../application/media/latestPreview";

export function ImportMediaVisual({
  entry,
  scrub = false,
  onMetadata,
}: {
  entry: ImportEntry;
  scrub?: boolean;
  onMetadata?: (metadata: ImportMetadata) => void;
}) {
  const lifetime = new RenderLifetime();

  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [cover, setCover] = useState("");
  const [frame, setFrame] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const hoverTime = useRef<number | null>(null);
  lifetime.useBeforePaint(() => {
    hoverTime.current = previewTimeUs(duration, progress, 100_000);
  });
  const previewRequest = useRef<{ request(timeUs: number): void } | null>(null);
  const reportMetadata = useRef(onMetadata);
  lifetime.useBeforePaint(() => {
    reportMetadata.current = onMetadata;
  });
  const kind = entry.is_directory ? null : mediaKind(entry.path);
  const Icon =
    kind === "audio"
      ? FileAudio2
      : kind === "image"
        ? Image
        : kind === "subtitle"
          ? Captions
          : FileVideo2;
  lifetime.useAfterCommit(() => {
    const observer = new IntersectionObserver(([item]) => setVisible(item.isIntersecting), {
      rootMargin: "100px",
    });
    if (host.current) observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  lifetime.useAfterCommit(() => {
    if (!visible || !kind || kind === "subtitle") return;
    let live = true;
    if (kind === "video" || kind === "image")
      void importCover(entry.path).then((src) => {
        if (live) setCover(src);
      });
    if (onMetadata || scrub)
      void importMetadata(entry.path).then((metadata) => {
        if (!live || !metadata) return;
        setDuration(metadata.duration_us);
        reportMetadata.current?.(metadata);
      });
    return () => {
      live = false;
    };
  }, [entry.path, visible, kind, scrub, Boolean(onMetadata)]);
  const hovering = progress !== null;
  lifetime.useAfterCommit(() => {
    if (!hovering || !duration || !scrub || kind !== "video") return;
    let live = true;
    const request = createLatestPreview(
      (time: number) =>
        queuePreview(() => (live ? importFrame(entry.path, time) : Promise.resolve(""))),
      (src) => {
        if (src) setFrame(src);
      },
      (error) => captureOperationError("thumbnail.video", error),
    );
    previewRequest.current = request;
    if (hoverTime.current !== null) request.request(hoverTime.current);
    return () => {
      live = false;
      request.dispose();
      previewRequest.current = null;
      setFrame("");
    };
  }, [hovering, duration, scrub, kind, entry.path]);
  return lifetime.render(
    <span
      ref={host}
      className="import-media-visual"
      onPointerMove={(event) => {
        if (!scrub || kind !== "video" || event.buttons) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const next = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const time = previewTimeUs(duration, next, 100_000);
        if (time !== null && time !== hoverTime.current) previewRequest.current?.request(time);
        hoverTime.current = time;
        setProgress(next);
      }}
      onPointerLeave={() => setProgress(null)}
    >
      {cover ? (
        <img src={hovering && frame ? frame : cover} alt="" draggable={false} />
      ) : entry.is_directory ? (
        <ImportFolderIcon />
      ) : (
        <Icon strokeWidth={1.2} />
      )}
      {scrub && hovering && cover && (
        <span className="import-scrub-line" style={{ left: `${progress! * 100}%` }} />
      )}
    </span>,
  );
}
