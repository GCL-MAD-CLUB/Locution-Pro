import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { version } from "../../../../package.json";
import license from "../../../../LICENSE?raw";
import thirdPartyNotices from "../../../../THIRD_PARTY_NOTICES?raw";
import { openExternalUrl } from "../../../platform/tauri/externalUrl";
import "./AboutDialog.css";

const appIconUrl = new URL("../../../../src-tauri/icons/icon.ico", import.meta.url).href;
const CREDITS_HOLD_MS = 3_000;
const CREDITS_SCROLL_PX_PER_SECOND = 12;

/**
 * Holds the credits still, then rolls them upward at a constant speed and stops
 * once the last line is fully visible. Reduced-motion users keep a static list.
 */
function useCreditsAutoScroll(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || container === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const scroller: HTMLDivElement = container;
    scroller.scrollTop = 0;
    let position = 0;
    let lastFrame = 0;
    let frame = 0;
    const holdTimer = window.setTimeout(() => {
      lastFrame = performance.now();
      frame = window.requestAnimationFrame(roll);
    }, CREDITS_HOLD_MS);

    function roll(now: number) {
      // Clamp the delta so returning from a hidden tab does not jump ahead.
      const elapsed = Math.min(now - lastFrame, 100) / 1000;
      lastFrame = now;
      position += elapsed * CREDITS_SCROLL_PX_PER_SECOND;
      const end = scroller.scrollHeight - scroller.clientHeight;
      scroller.scrollTop = Math.min(position, end);
      if (position < end) frame = window.requestAnimationFrame(roll);
    }

    return () => {
      window.clearTimeout(holdTimer);
      window.cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return containerRef;
}

interface AboutDialogProps {
  onClose: () => void;
}

export function AboutDialog({ onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [showLegal, setShowLegal] = useState(false);
  const creditsRef = useCreditsAutoScroll(!showLegal);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    // A native modal keeps pointer and keyboard focus out of the underlying workspace.
    dialog?.showModal();
    dialog?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    if (!(event.target instanceof Element)) return;
    // Credits links belong in the system browser; the webview itself must not navigate.
    const link = event.target.closest("a[href]");
    if (link instanceof HTMLAnchorElement) {
      event.preventDefault();
      void openExternalUrl(link.href);
      return;
    }
    // The legal toggle and the license text stay interactive so it can be selected and scrolled.
    if (event.target.closest(".about-dialog-legal, .about-dialog-legal-link")) return;
    // Backdrop clicks also target the dialog element, so only the panel area dismisses it.
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const bounds = dialog.getBoundingClientRect();
    const withinPanel =
      event.clientX >= bounds.left &&
      event.clientX <= bounds.right &&
      event.clientY >= bounds.top &&
      event.clientY <= bounds.bottom;
    if (withinPanel) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    event.stopPropagation();
    if (
      event.altKey ||
      event.key === "F5" ||
      ((event.ctrlKey || event.metaKey) && !["a", "c"].includes(event.key.toLowerCase()))
    ) {
      event.preventDefault();
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    const controls = dialog?.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]');
    const first = controls?.[0];
    const last = controls?.[controls.length - 1];
    if (!first || !last) return;
    if (document.activeElement === dialog || (!event.shiftKey && document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="about-dialog-header">
        <img className="about-dialog-icon" src={appIconUrl} alt="" />
        <div>
          <h1 id={titleId}>Locution Pro</h1>
          <p className="about-dialog-version">版本 {version}</p>
        </div>
      </header>

      <p id={descriptionId} className="about-dialog-description">
        关于 Locution Pro，按 Esc 关闭。
      </p>

      {showLegal ? (
        <section className="about-dialog-legal" aria-label="法律声明" tabIndex={0}>
          <h2>Locution Pro</h2>
          <pre>{license}</pre>
          <h2>第三方软件声明</h2>
          <pre>{thirdPartyNotices}</pre>
        </section>
      ) : (
        <div ref={creditsRef} className="about-dialog-credits">
          <h2>Locution Pro</h2>
          <p>Media Management and Visual Search</p>

          <dl>
            <div>
              <dt>Development Team</dt>
              <dd>
                <a href="https://space.bilibili.com/99325557">Kotodama Yl</a>
              </dd>
            </div>
            <div>
              <dt>Art and Design Team</dt>
              <dd>
                <a href="https://space.bilibili.com/99325557">Kotodama Yl</a>,{" "}
                <a href="https://space.bilibili.com/114981540">Cupidouo</a>
              </dd>
              <dd>
                <br></br>
                Icon Designer<br></br>
                <a href="https://space.bilibili.com/114981540">Cupidouo</a>
              </dd>
            </div>
            <div>
              <dt>Internal Testing Team</dt>
              <dd>
                <a href="https://space.bilibili.com/99325557">Kotodama Yl</a>,{" "}
                <a href="https://space.bilibili.com/35331179">imdumbass</a>
              </dd>
            </div>
            <div>
              <dt>Contributors</dt>
              <dd>
                <a href="https://space.bilibili.com/99325557">Kotodama Yl</a>
              </dd>
            </div>
            <div>
              <dt>Acknowledgements</dt>
              <dd>
                <a href="https://space.bilibili.com/35331179">imdumbass</a>,{" "}
                <a href="https://space.bilibili.com/114981540">Cupidouo</a>,{" "}
                <a href="https://space.bilibili.com/1831240178">云锡Snclouds</a>,{" "}
                <a href="https://space.bilibili.com/190665266">银河千川</a>,{" "}
                <a href="https://space.bilibili.com/417204">达兹米蛋糕</a>,{" "}
                <a href="https://space.bilibili.com/46743863">泊叙</a>,{" "}
                <a href="https://space.bilibili.com/515129164">一与孤</a>,{" "}
                <a href="https://space.bilibili.com/503500972">-樱汐-</a>,{" "}
                <a href="https://space.bilibili.com/346346206">暗黑要樂奈</a>,{" "}
                <a href="https://space.bilibili.com/1201822654">抹茶破忒头</a>
                <br></br>
                <br></br>
                Thank you to all the users who participated in testing, provided feedback, and
                contributed to improvements.
              </dd>
            </div>
            <div>
              <dt>Open Source</dt>
              <dd>
                Locution Pro is built on React and TypeScript for the interface, Tauri and Rust for
                the desktop shell and native backend, and FFmpeg/FFprobe for media decoding,
                encoding, and inspection. Storyboard and semantic search draw on TransNetV2
                shot-boundary detection, DINOv3 frame selection, and Jina embedding models. Thank
                you to the maintainers of these projects and to the wider open-source community.
              </dd>
            </div>
          </dl>
        </div>
      )}

      <footer className="about-dialog-footer">
        <div>
          <p>Locution Pro 开源项目</p>
          <p>Apache License 2.0</p>
          <button
            type="button"
            className="about-dialog-legal-link"
            aria-expanded={showLegal}
            onClick={() => setShowLegal((current) => !current)}
          >
            {showLegal ? "返回" : "法律声明"}
          </button>
        </div>
        <div className="about-dialog-wordmark" aria-label="GCL MAD CLUB">
          <img src={appIconUrl} alt="" />
          <span>GCL MAD CLUB</span>
        </div>
      </footer>
    </dialog>
  );
}
