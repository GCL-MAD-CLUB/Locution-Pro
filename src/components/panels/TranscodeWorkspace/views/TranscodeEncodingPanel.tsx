import { useEffect, useState } from "react";
import {
  fileName,
  formatDuration,
  outputSummary,
  sourceSummary,
  useTranscodeQueueState,
} from "../../../../systems/TranscodeSystem";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function TranscodeEncodingPanel() {
  const sources = useTranscodeQueueState((state) => state.sources);
  const activeOutputId = useTranscodeQueueState((state) => state.activeOutputId);
  const capabilities = useTranscodeQueueState((state) => state.capabilities);
  const configLoaded = useTranscodeQueueState((state) => state.configLoaded);
  const active = sources
    .flatMap((source) => source.outputs.map((output) => ({ source, output })))
    .find(({ output }) => output.id === activeOutputId);
  const now = useNow(Boolean(active));

  if (!active) {
    return (
      <div className="transcode-encoding is-idle">
        <p className="transcode-empty">
          {configLoaded && !capabilities
            ? "未能读取 FFmpeg 信息，请在“首选项”中检查 FFmpeg 路径。"
            : "目前尚未进行编码。"}
        </p>
        {capabilities?.version && (
          <p className="transcode-note">编码器：FFmpeg {capabilities.version}</p>
        )}
      </div>
    );
  }

  const { source, output } = active;
  const elapsedMs = output.startedAt ? now - output.startedAt : 0;
  const remainingMs =
    output.progress > 0.01 ? (elapsedMs / output.progress) * (1 - output.progress) : null;
  return (
    <div className="transcode-encoding">
      <div className="transcode-encoding-title" title={source.path}>
        {fileName(source.path)}
      </div>
      <dl className="transcode-summary">
        <dt>源</dt>
        <dd>
          {sourceSummary(source.info).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
        <dt>输出</dt>
        <dd>
          {outputSummary(output.settings, source.info).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
      </dl>
      <div
        className="transcode-encoding-progress"
        role="progressbar"
        aria-valuenow={Math.round(output.progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${output.progress * 100}%` }} />
      </div>
      <div className="transcode-encoding-times">
        <span>已用时间：{formatDuration(elapsedMs * 1000)}</span>
        <span>
          剩余时间：{remainingMs === null ? "正在估算" : formatDuration(remainingMs * 1000)}
        </span>
        <span>{Math.round(output.progress * 100)}%</span>
      </div>
    </div>
  );
}
