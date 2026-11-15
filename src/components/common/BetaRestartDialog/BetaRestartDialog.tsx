import { useRef } from "react";
import { ModalDialog } from "../ModalDialog";
import "./BetaRestartDialog.css";

interface BetaRestartDialogProps {
  enabling: boolean;
  needsSave: boolean;
  restarting: boolean;
  blocked: boolean;
  onRestart: () => void;
  onLater: () => void;
}

export function BetaRestartDialog({
  enabling,
  needsSave,
  restarting,
  blocked,
  onRestart,
  onLater,
}: BetaRestartDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <ModalDialog
      title="重启软件"
      className="beta-restart-dialog"
      bodyClassName="beta-restart-dialog-body"
      focusTrap
      initialFocusRef={confirmRef}
      onConfirm={onRestart}
      onCancel={onLater}
      actions={
        <>
          <button
            ref={confirmRef}
            type="button"
            className="modal-dialog-confirm"
            disabled={restarting || blocked}
            onClick={onRestart}
          >
            {restarting ? "正在重启…" : needsSave ? "保存后重启" : "立即重启"}
          </button>
          <button
            type="button"
            className="modal-dialog-cancel"
            disabled={restarting}
            onClick={onLater}
          >
            稍后
          </button>
        </>
      }
    >
      <h3 className="beta-restart-dialog-title">{enabling ? "启用" : "关闭"}转码（Beta）</h3>
      <div className="beta-restart-dialog-divider" />
      <p className="beta-restart-dialog-message">
        {enabling
          ? "重启软件后，即可使用转码页面及相关功能。"
          : "重启软件后，将关闭转码页面及相关功能。"}
      </p>
    </ModalDialog>
  );
}
