import { useEffect, useState } from "react";
import { SelectDropdown, type SelectDropdownItem } from "../../../common/SelectDropdown";
import type { TranscodeOptionItem } from "../../../../systems/TranscodeSystem";

function dropdownItems(items: readonly TranscodeOptionItem[]): Array<SelectDropdownItem<string>> {
  return items.map((item) =>
    "separator" in item
      ? { type: "separator" }
      : { type: "option", value: item.value, label: item.label },
  );
}

interface TranscodeDropdownProps {
  ariaLabel: string;
  value: string;
  items: readonly TranscodeOptionItem[];
  disabled?: boolean;
  className?: string;
  /** Shown when the value is not among the items (an unknown stored value). */
  fallbackLabel?: string;
  onChange: (value: string) => void;
}

export function TranscodeDropdown({
  ariaLabel,
  value,
  items,
  disabled = false,
  className,
  fallbackLabel,
  onChange,
}: TranscodeDropdownProps) {
  const known = items.some((item) => !("separator" in item) && item.value === value);
  return (
    <SelectDropdown
      className={`export-select ${className ?? ""}`}
      menuClassName="transcode-dropdown-menu"
      menuMinWidth={140}
      menuWidth="content"
      ariaLabel={ariaLabel}
      disabled={disabled}
      value={value}
      selectedLabel={known ? undefined : (fallbackLabel ?? value)}
      items={dropdownItems(items)}
      onChange={onChange}
    />
  );
}

interface TranscodeNumberFieldProps {
  ariaLabel: string;
  value: number | null;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  placeholder?: string;
  /** Called with null when the field is cleared. */
  onChange: (value: number | null) => void;
}

/** A numeric text field that commits a clamped value on blur or Enter. */
export function TranscodeNumberField({
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  placeholder,
  onChange,
}: TranscodeNumberFieldProps) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value === null ? "" : String(value));
      return;
    }
    const clamped = Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
    const snapped = step >= 1 ? Math.round(clamped) : clamped;
    setDraft(String(snapped));
    if (snapped !== value) onChange(snapped);
  }

  return (
    <input
      className="export-text-input transcode-number-input"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

interface TranscodeCheckProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function TranscodeCheck({
  label,
  checked,
  disabled = false,
  onChange,
}: TranscodeCheckProps) {
  return (
    <label className={`export-check-label ${disabled ? "is-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      {label}
    </label>
  );
}
