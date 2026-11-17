import { RenderLifetime } from "../../../../runtime/lifetime/RenderLifetime";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { PopupMenu, useCloseOnOutsidePointer } from "../../../common/PopupMenu";

export function ImportMenu({
  anchor,
  label,
  onClose,
  children,
  light = false,
}: {
  anchor: { x: number; y: number };
  label: string;
  onClose: () => void;
  children: ReactNode;
  light?: boolean;
}) {
  const lifetime = new RenderLifetime();

  useCloseOnOutsidePointer(lifetime, true, onClose, { ignorePopupMenuTargets: true });
  return lifetime.render(
    createPortal(
      <PopupMenu
        className={`import-popup ${light ? "is-light" : "is-dark"}`}
        ariaLabel={label}
        contextMenuAnchor={anchor}
        style={{ position: "fixed", left: anchor.x, top: anchor.y, zIndex: 200 }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </PopupMenu>,
      document.body,
    ),
  );
}
