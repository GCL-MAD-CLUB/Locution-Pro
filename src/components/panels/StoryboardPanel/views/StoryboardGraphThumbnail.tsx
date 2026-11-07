import { Star, Tags } from "lucide-react";
import type { PanelRowSource } from "../../../../core/editor/multiSource";
import { frameToTimeUs } from "../../../../core/editor/timeline";
import type { StoryboardShot, StoryboardShotAnnotation } from "../../../../types";
import { ShotFrameButton } from "./StoryboardShotThumbnail";

export function StoryboardGraphThumbnail({
  shot,
  source,
  annotation,
  thumbnailFrame,
  priority,
  requestEnabled,
}: {
  shot: StoryboardShot;
  source: PanelRowSource;
  annotation?: StoryboardShotAnnotation;
  thumbnailFrame: number;
  priority: number;
  requestEnabled: boolean;
}) {
  const flag = annotation?.retained ? "retained" : annotation?.excluded ? "excluded" : "none";
  const rating = annotation?.rating ?? 0;
  return (
    <>
      <ShotFrameButton
        shot={shot}
        {...source}
        priority={priority}
        requestEnabled={requestEnabled}
        resolution={{ width: 640, height: 360 }}
        thumbnailTimeUs={frameToTimeUs(thumbnailFrame, source.frameRate)}
        previewOnly
        onSelect={(event) => event.preventDefault()}
        onStartKeywordDrag={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      <div className="storyboard-graph-preview-metadata">
        {flag !== "none" && (
          <span
            className={`shot-thumbnail-flag is-${flag}`}
            role="img"
            aria-label={flag === "retained" ? "留用旗标" : "排除旗标"}
          />
        )}
        {rating > 0 && (
          <span className="storyboard-graph-preview-rating" role="img" aria-label={`${rating} 星`}>
            {Array.from({ length: rating }, (_, index) => (
              <Star key={index} aria-hidden="true" />
            ))}
          </span>
        )}
        {Boolean(annotation?.keywordIds?.length) && (
          <span
            className="shot-thumbnail-keyword-indicator"
            role="img"
            aria-label="该分镜包含关键字"
          >
            <Tags aria-hidden="true" />
          </span>
        )}
      </div>
    </>
  );
}
