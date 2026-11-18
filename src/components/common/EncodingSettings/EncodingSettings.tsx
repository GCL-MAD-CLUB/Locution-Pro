import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
interface ExportFieldProps {
  label: string;
  /** The control stacks multiple rows; keeps the label aligned to the first one. */
  stacked?: boolean;
  children: ReactNode;
}

export function ExportField({ label, stacked = false, children }: ExportFieldProps) {
  return (
    <div className={`export-settings-field ${stacked ? "export-settings-field-stacked" : ""}`}>
      <span className="export-settings-field-label">{label}</span>
      <div className="export-settings-field-control">{children}</div>
    </div>
  );
}

interface ExportSettingsGroupProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** When provided, the header shows an enable switch bound to these props. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  switchDisabled?: boolean;
  switchAriaLabel?: string;
  children: ReactNode;
}

export function ExportSettingsGroup({
  title,
  open,
  onToggle,
  enabled,
  onEnabledChange,
  switchDisabled = false,
  switchAriaLabel,
  children,
}: ExportSettingsGroupProps) {
  return (
    <section className="export-settings-group">
      <div className="export-settings-group-header">
        <button
          type="button"
          className="export-settings-group-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronDown
            size={14}
            className={`export-settings-group-chevron ${open ? "" : "is-collapsed"}`}
          />
          <span>{title}</span>
        </button>
        {onEnabledChange && (
          <label className={`export-switch ${switchDisabled ? "is-disabled" : ""}`}>
            <input
              type="checkbox"
              checked={enabled ?? false}
              disabled={switchDisabled}
              aria-label={switchAriaLabel ?? `${title}开关`}
              onChange={(event) => onEnabledChange(event.target.checked)}
            />
            <span className="export-switch-track" />
          </label>
        )}
      </div>
      {open && <div className="export-settings-group-body">{children}</div>}
    </section>
  );
}
