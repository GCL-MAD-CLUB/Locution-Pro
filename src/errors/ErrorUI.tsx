import { Download, Loader2, TriangleAlert } from "lucide-react";
import {
  Component,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { ModalDialog } from "../components/common/ModalDialog";
import { openExternalUrl } from "../platform/tauri/externalUrl";
import { incidentRecovery, type IncidentRecovery } from "./recovery";
import type { Incident } from "./model";
import {
  captureIncident,
  captureOperationError,
  dismissIncident,
  getIncidentSnapshot,
  normalizeError,
  subscribeIncidents,
} from "./runtime";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const normalized = normalizeError(error);
    normalized.detail = `${normalized.detail}\n${info.componentStack ?? ""}`;
    captureIncident("runtime.render", normalized);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="fatal-error-fallback">
          <strong>应用界面暂时无法继续运行</strong>
          <span>请关闭错误提示后重新启动应用。</span>
        </main>
      );
    }
    return this.props.children;
  }
}

export function ErrorOutlet() {
  const { incidents } = useSyncExternalStore(
    subscribeIncidents,
    getIncidentSnapshot,
    getIncidentSnapshot,
  );
  const modal = incidents.find((incident) => incident.presentation === "modal");
  return modal ? <IncidentDialog key={modal.id} incident={modal} /> : null;
}

function IncidentDialog({ incident }: { incident: Incident }) {
  const recovery = incidentRecovery(incident.code);
  if (recovery) {
    return <RecoveryIncidentDialog incident={incident} recovery={recovery} />;
  }

  return (
    <ModalDialog
      title={incident.title}
      className="error-dialog"
      bodyClassName="error-dialog-body"
      onCancel={() => dismissIncident(incident.id)}
      onConfirm={() => dismissIncident(incident.id)}
      actions={
        <button
          type="button"
          className="modal-dialog-confirm"
          onClick={() => dismissIncident(incident.id)}
        >
          确定
        </button>
      }
    >
      <TriangleAlert className="error-dialog-icon" aria-hidden="true" />
      <div>
        <p>{incident.message}</p>
        <p>{`ERROR: ${incident.category.charAt(0).toUpperCase() + incident.category.slice(1)}Error`}</p>
      </div>
    </ModalDialog>
  );
}

function RecoveryIncidentDialog({
  incident,
  recovery,
}: {
  incident: Incident;
  recovery: IncidentRecovery;
}) {
  const action = recovery.action;
  const downloadRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const [opening, setOpening] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const dismiss = () => dismissIncident(incident.id);

  async function openRecovery() {
    if (!action || opening) return;
    setOpening(true);
    setOpenFailed(false);
    try {
      await openExternalUrl(action.url);
    } catch (error) {
      captureOperationError("runtime.recovery", error);
      setOpenFailed(true);
    } finally {
      setOpening(false);
    }
  }

  return (
    <ModalDialog
      title={incident.title}
      className="error-dialog error-dialog-recovery"
      bodyClassName="error-dialog-body"
      focusTrap
      initialFocusRef={action ? downloadRef : dismissRef}
      onCancel={dismiss}
      onConfirm={dismiss}
      actions={
        <>
          {action ? (
            <button
              ref={downloadRef}
              type="button"
              className="modal-dialog-confirm error-dialog-download"
              disabled={opening}
              onClick={() => void openRecovery()}
            >
              {opening ? (
                <Loader2 size={14} className="spin" aria-hidden="true" />
              ) : (
                <Download size={14} aria-hidden="true" />
              )}
              {opening ? "正在打开…" : action.label}
            </button>
          ) : null}
          <button
            ref={dismissRef}
            type="button"
            className={action ? "modal-dialog-cancel" : "modal-dialog-confirm"}
            onClick={dismiss}
          >
            关闭
          </button>
        </>
      }
    >
      <TriangleAlert className="error-dialog-icon" aria-hidden="true" />
      <div className="error-dialog-content">
        <h3>{recovery.component}</h3>
        {incident.contextTitle ? (
          <p className="error-dialog-context">{incident.contextTitle}</p>
        ) : null}
        <p>{incident.message}</p>
        <ol className="error-dialog-steps" aria-label="修复步骤">
          {recovery.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {openFailed && action ? (
          <div className="error-dialog-link-failure" role="alert">
            <p>无法打开下载链接，请重试，或复制以下地址到浏览器：</p>
            <span>{action.url}</span>
          </div>
        ) : null}
        <small>错误编号：{incident.errorId}</small>
      </div>
    </ModalDialog>
  );
}
