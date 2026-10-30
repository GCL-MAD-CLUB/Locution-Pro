import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { SelectDropdown, selectDropdownItems } from "../SelectDropdown";
import {
  filterSearchHistory,
  hasAdvancedSearch,
  readSearchHistory,
  rememberSearch,
  searchHistorySpace,
  type SearchConfiguration,
  type SearchHistoryEntry,
  type SearchHistoryKind,
} from "./searchHistory";

export function SearchHistoryInput({
  label,
  kind,
  configuration,
  onConfigurationSelect,
  query,
  disabled,
  onQueryChange,
  normalizeQuery = (value) => value,
}: {
  label: string;
  kind: SearchHistoryKind;
  configuration: SearchConfiguration;
  onConfigurationSelect: (configuration: SearchConfiguration) => void;
  query: string;
  disabled: boolean;
  onQueryChange: (query: string) => void;
  normalizeQuery?: (value: string) => string;
}) {
  const listId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const lastEditedQuery = useRef<string | null>(null);
  useEffect(() => {
    if (query !== lastEditedQuery.current) setDraft(null);
  }, [query]);
  const space = searchHistorySpace(configuration.mode);
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const suggestions = filterSearchHistory(history, query);
  const visible = open && !disabled && suggestions.length > 0;
  const activeIndex = suggestions.findIndex((entry) => entry.text === active);

  useEffect(() => {
    setHistory(readSearchHistory(kind, space));
    setActive(null);
  }, [kind, space]);

  function select(value: string) {
    const entry = suggestions.find((entry) => entry.text === value);
    if (!entry) return;
    setDraft(null);
    lastEditedQuery.current = null;
    setHistory(rememberSearch(kind, entry.configuration));
    onConfigurationSelect(entry.configuration);
    setActive(null);
    setOpen(false);
  }

  return (
    <SelectDropdown
      className="panel-search-input"
      menuId={listId}
      ariaLabel={`${label}最近搜索`}
      open={visible}
      onOpenChange={setOpen}
      showCheck={false}
      menuClassName="panel-search-history-menu"
      disabled={disabled}
      placement="bottom"
      value={active ?? ""}
      items={selectDropdownItems(suggestions.map((entry) => [entry.text, entry.text] as const))}
      renderOptionLabel={(item) => {
        const entry = suggestions.find((entry) => entry.text === item.value);
        return (
          <>
            <span className="panel-search-history-text">{item.label}</span>
            {entry && hasAdvancedSearch(entry.configuration) && (
              <span className="panel-search-history-advanced" aria-hidden="true">
                *
              </span>
            )}
          </>
        );
      }}
      onChange={select}
      triggerElement={
        <>
          <Search aria-hidden="true" />
          <input
            value={draft ?? query}
            placeholder={`搜索${label}`}
            aria-label={`搜索${label}`}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={visible ? listId : undefined}
            aria-activedescendant={
              visible && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
            }
            onFocus={() => {
              setHistory(readSearchHistory(kind, space));
              setActive(null);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              lastEditedQuery.current = normalizeQuery(value);
              setDraft(value);
              onQueryChange(value);
              setActive(null);
              setOpen(true);
            }}
            onBlur={() => {
              setHistory(rememberSearch(kind, configuration));
              setDraft(null);
              setOpen(false);
              setActive(null);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!suggestions.length) return;
                event.preventDefault();
                event.stopPropagation();
                const next =
                  activeIndex < 0
                    ? event.key === "ArrowDown"
                      ? 0
                      : suggestions.length - 1
                    : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) %
                      suggestions.length;
                setActive(suggestions[next].text);
                setOpen(true);
              } else if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (visible && activeIndex >= 0) select(suggestions[activeIndex].text);
                else {
                  setOpen(false);
                  setActive(null);
                }
              } else if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setActive(null);
              }
            }}
          />
        </>
      }
    />
  );
}
