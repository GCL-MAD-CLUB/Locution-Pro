import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MediaBrowserDialog } from "../../../../src/components/common/MediaBrowserDialog/MediaBrowserDialog";
import { MediaLinkDialog } from "../../../../src/components/common/MediaLinkDialog/MediaLinkDialog";
import { ErrorOutlet } from "../../../../src/errors";
import "../../../../src/styles.css";

function Harness() {
  const [result, setResult] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  return (
    <>
      <output aria-label="操作结果">{JSON.stringify(result)}</output>
      {open &&
        (new URLSearchParams(location.search).get("kind") === "link" ? (
          <MediaLinkDialog
            candidates={[
              {
                id: "a",
                clipName: "镜头一",
                filePath: "C:/old/clip.MP4",
                kind: "video",
                mediaStartUs: 0,
              },
            ]}
            mode="media"
            onCancel={() => setOpen(false)}
            onAttach={async (_, path) => {
              setResult([path]);
              return true;
            }}
          />
        ) : (
          <MediaBrowserDialog
            title="选择测试媒体"
            initialDirectory="C:/media"
            filters={[{ name: "视频", extensions: ["mp4", "mov"] }]}
            onCancel={() => setOpen(false)}
            onConfirm={(paths) => {
              setResult(paths);
              setOpen(false);
            }}
          />
        ))}
      <ErrorOutlet />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
