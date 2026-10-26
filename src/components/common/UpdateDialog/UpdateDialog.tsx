import { ArrowUpRight, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MouseEvent } from "react";
import { currentVersion, type ReleaseInfo } from "../../../application/update";
import { captureOperationError } from "../../../errors";
import { openExternalUrl, resolveExternalUrl } from "../../../platform/tauri/externalUrl";
import { ModalDialog } from "../ModalDialog";
import "./UpdateDialog.css";

const appIconUrl = new URL("../../../../src-tauri/icons/icon.ico", import.meta.url).href;

export type UpdateDialogState =
  | { status: "checking" }
  | { status: "available"; release: ReleaseInfo }
  | { status: "latest" }
  | { status: "failed" };

interface UpdateDialogProps {
  state: UpdateDialogState;
  onClose: () => void;
  onRetry: () => void;
}

async function openReleaseUrl(url: string) {
  try {
    await openExternalUrl(url);
  } catch (error) {
    captureOperationError("help.checkUpdates", error);
  }
}

export function UpdateDialog({ state, onClose, onRetry }: UpdateDialogProps) {
  const title = state.status === "failed" ? "检查更新失败" : "检查更新";
  const actions =
    state.status === "available" ? (
      <>
        <button
          type="button"
          className="modal-dialog-confirm"
          onClick={() => void openReleaseUrl(state.release.url)}
        >
          前往发布页
          <ArrowUpRight size={14} />
        </button>
        <button type="button" className="modal-dialog-cancel" onClick={onClose}>
          稍后
        </button>
      </>
    ) : state.status === "failed" ? (
      <>
        <button type="button" className="modal-dialog-confirm" onClick={onRetry}>
          <RefreshCw size={13} />
          重试
        </button>
        <button type="button" className="modal-dialog-cancel" onClick={onClose}>
          关闭
        </button>
      </>
    ) : state.status === "latest" ? (
      <button type="button" className="modal-dialog-confirm" onClick={onClose}>
        完成
      </button>
    ) : (
      <button type="button" className="modal-dialog-cancel" onClick={onClose}>
        取消
      </button>
    );

  return (
    <ModalDialog
      className={
        state.status === "available" ? "update-dialog update-dialog-available" : "update-dialog"
      }
      bodyClassName="update-dialog-body"
      title={title}
      actions={actions}
      onCancel={onClose}
      onConfirm={onClose}
    >
      {state.status === "checking" && (
        <div className="update-dialog-status" role="status">
          <div className="update-dialog-visual">
            <Loader2 className="spin" size={28} />
          </div>
          <div>
            <h3>正在检查新版本</h3>
            <p>正在连接发布服务，请稍候…</p>
          </div>
        </div>
      )}

      {state.status === "latest" && (
        <div className="update-dialog-status" role="status">
          <div className="update-dialog-visual">
            <img className="update-dialog-icon" src={appIconUrl} alt="" />
          </div>
          <div>
            <h3>当前已是最新版本</h3>
            <p>Locution Pro {currentVersion} 已是最新版本，无需更新。</p>
          </div>
        </div>
      )}

      {state.status === "failed" && (
        <div className="update-dialog-status" role="alert">
          <div className="update-dialog-visual">
            <CircleAlert size={28} />
          </div>
          <div>
            <h3>暂时无法检查更新</h3>
            <p>请检查网络连接后重试。你仍然可以继续使用当前版本。</p>
          </div>
        </div>
      )}

      {state.status === "available" && (
        <>
          <div className="update-dialog-summary">
            <img className="update-dialog-summary-icon" src={appIconUrl} alt="" />
            <div className="update-dialog-summary-content">
              <div className="update-dialog-title-row">
                <h3>{state.release.title || `Locution Pro ${state.release.version}`}</h3>
                <span className="update-dialog-badge">新版本</span>
              </div>
              <p>
                {state.release.version} <span>当前版本 {currentVersion}</span>
              </p>
            </div>
          </div>
          <section className="update-dialog-notes" aria-label="版本更新说明">
            {state.release.body.trim() ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    const url = href ? resolveExternalUrl(href) : null;
                    return (
                      <a
                        href={url ?? undefined}
                        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                          event.preventDefault();
                          if (url) void openReleaseUrl(url);
                        }}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {state.release.body}
              </ReactMarkdown>
            ) : (
              <p className="update-dialog-empty">此版本没有提供更新说明。</p>
            )}
          </section>
        </>
      )}
    </ModalDialog>
  );
}
