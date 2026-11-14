import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import type { AssetLibrarySort, AssetLibrarySortKey } from "../../../../core/editor/assetLibrary";
import {
  PopupMenu,
  PopupMenuItem,
  PopupMenuSeparator,
  useCloseOnOutsidePointer,
} from "../../../common/PopupMenu";
import {
  assetLibraryColumns,
  assetLibraryToggleableColumns,
  type AssetLibraryColumn,
  type AssetLibraryColumnId,
  type AssetLibraryColumnScope,
  type AssetLibraryColumnWidths,
} from "../assetLibraryColumns";

interface ColumnResize {
  id: AssetLibraryColumnId;
  startX: number;
  startWidth: number;
  pointerId: number;
}

export interface AssetLibraryListHeaderProps {
  root: AssetLibraryColumnScope;
  columns: readonly AssetLibraryColumn[];
  columnWidths: AssetLibraryColumnWidths;
  visibleColumns: ReadonlySet<AssetLibraryColumnId>;
  sort: AssetLibrarySort;
  itemCount: number;
  selectedCount: number;
  itemCheckboxes: boolean;
  onSort: (sort: AssetLibrarySort) => void;
  onToggleColumn: (column: AssetLibraryColumnId) => void;
  onColumnWidthChange: (column: AssetLibraryColumnId, width: number) => void;
  onResetColumnWidths: () => void;
  onToggleAllSelected: () => void;
}

function SelectAllCheckbox({
  checked,
  mixed,
  disabled,
  onToggle,
}: {
  checked: boolean;
  mixed: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="asset-library-check"
      checked={checked}
      disabled={disabled}
      aria-label={checked ? "全部取消" : "全选"}
      title={checked ? "全部取消" : "全选"}
      onChange={onToggle}
    />
  );
}

function SortArrow({ direction }: { direction: AssetLibrarySort["direction"] }) {
  return (
    <svg className="media-bin-sort-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={
          direction === "ascending"
            ? "M8 14 L8 2.5 M5 5.5 L8 2.5 L11 5.5"
            : "M8 2 L8 13.5 M5 10.5 L8 13.5 L11 10.5"
        }
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.75"
      />
    </svg>
  );
}

/** Media bin column header with sorting, resizable detail columns and a column menu. */
export function AssetLibraryListHeader(props: AssetLibraryListHeaderProps) {
  const { columns, columnWidths, visibleColumns, sort, itemCount, selectedCount, itemCheckboxes } =
    props;
  const columnResizeRef = useRef<ColumnResize | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);

  useCloseOnOutsidePointer(Boolean(headerMenu), () => setHeaderMenu(null), {
    capturePointerdown: true,
    ignorePopupMenuTargets: true,
  });

  function toggleSort(key: AssetLibrarySortKey) {
    props.onSort({
      key,
      direction: sort.key === key && sort.direction === "ascending" ? "descending" : "ascending",
    });
  }

  // As in the storyboard table, each left-edge handle resizes the preceding column.
  function startColumnResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: AssetLibraryColumnId,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    columnResizeRef.current = {
      id,
      startX: event.clientX,
      startWidth: columnWidths[id],
      pointerId: event.pointerId,
    };
    document.body.classList.add("is-resizing-media-column");
  }

  function updateColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = columnResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    props.onColumnWidthChange(resize.id, resize.startWidth + event.clientX - resize.startX);
  }

  function finishColumnResize(event: ReactPointerEvent<HTMLButtonElement>) {
    const resize = columnResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    columnResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.classList.remove("is-resizing-media-column");
  }

  useEffect(() => () => document.body.classList.remove("is-resizing-media-column"), []);

  function renderResizer(id: AssetLibraryColumnId) {
    const column = assetLibraryColumns.find((candidate) => candidate.id === id)!;
    return (
      <button
        type="button"
        className="media-bin-column-resizer"
        title=""
        aria-label={`调整${column.label}列宽`}
        onPointerDown={(event) => startColumnResize(event, id)}
        onPointerMove={updateColumnResize}
        onPointerUp={finishColumnResize}
        onPointerCancel={finishColumnResize}
        onLostPointerCapture={finishColumnResize}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={() => props.onColumnWidthChange(id, column.width)}
      />
    );
  }

  function renderColumnHeader(column: AssetLibraryColumn, index: number) {
    const active = column.sortKey !== null && sort.key === column.sortKey;
    const nextDirection = active && sort.direction === "ascending" ? "降序" : "升序";
    return (
      <span
        key={column.id}
        className="media-bin-column-header"
        role="columnheader"
        aria-sort={active ? sort.direction : undefined}
      >
        {column.sortKey ? (
          <button
            type="button"
            className={`media-bin-column-sort-button${active ? " active" : ""}`}
            title={`按${column.label}${nextDirection}排列`}
            aria-label={`按${column.label}${nextDirection}排列`}
            disabled={itemCount === 0}
            onClick={() => toggleSort(column.sortKey!)}
          >
            <span className="media-bin-column-label-text">{column.label}</span>
            {active && <SortArrow direction={sort.direction} />}
          </button>
        ) : (
          <span className="media-bin-column-label-text">{column.label}</span>
        )}
        {renderResizer(index === 0 ? "name" : columns[index - 1]!.id)}
      </span>
    );
  }

  function renderHeader() {
    const nameActive = sort.key === "name";
    const nameDirection = nameActive && sort.direction === "ascending" ? "降序" : "升序";
    return (
      <div
        className="media-bin-table-header-viewport"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div
          className="media-bin-table-header"
          role="row"
          title="右键选择要显示的列"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setHeaderMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <span
            className="media-bin-column-header asset-library-title-header"
            role="columnheader"
            aria-sort={nameActive ? sort.direction : undefined}
          >
            {itemCheckboxes && (
              <SelectAllCheckbox
                checked={itemCount > 0 && selectedCount === itemCount}
                mixed={selectedCount > 0 && selectedCount < itemCount}
                disabled={itemCount === 0}
                onToggle={props.onToggleAllSelected}
              />
            )}
            <button
              type="button"
              className={`media-bin-column-sort-button${nameActive ? " active" : ""}`}
              title={`按名称${nameDirection}排列`}
              aria-label={`按名称${nameDirection}排列`}
              disabled={itemCount === 0}
              onClick={() => toggleSort("name")}
            >
              <span className="media-bin-column-label-text">名称</span>
              {nameActive && <SortArrow direction={sort.direction} />}
            </button>
          </span>
          {columns.map(renderColumnHeader)}
          <span className="media-bin-column-header" role="columnheader">
            {renderResizer(columns.at(-1)?.id ?? "name")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <>
      {renderHeader()}
      {headerMenu &&
        createPortal(
          <PopupMenu
            className="asset-library-context-menu"
            contextMenuAnchor={headerMenu}
            ariaLabel="显示的列"
            style={{ position: "fixed", left: headerMenu.x, top: headerMenu.y }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <PopupMenuItem checked disabled>
              名称
            </PopupMenuItem>
            {assetLibraryToggleableColumns(props.root).map((column) => (
              <PopupMenuItem
                key={column.id}
                checked={visibleColumns.has(column.id)}
                onSelect={() => {
                  setHeaderMenu(null);
                  props.onToggleColumn(column.id);
                }}
              >
                {column.label}
              </PopupMenuItem>
            ))}
            <PopupMenuSeparator />
            <PopupMenuItem
              onSelect={() => {
                setHeaderMenu(null);
                props.onResetColumnWidths();
              }}
            >
              重置列宽
            </PopupMenuItem>
          </PopupMenu>,
          document.body,
        )}
    </>
  );
}
