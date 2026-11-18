import { SelectDropdown, type SelectDropdownItem } from "../../../common/SelectDropdown";
import { useSourceMonitorState, type MonitorZoomLevel } from "../sourceMonitorState";

const baseZoomPercentOptions = [10, 25, 50, 75, 100, 150, 200, 400, 800, 1600] as const;

/**
 * The viewer zoom menu. It reads the monitor's panel state, so it lives in
 * its own component that only monitors render.
 */
export function MonitorZoomSelect() {
  const zoomLevel = useSourceMonitorState((state) => state.zoomLevel);
  const setZoomLevel = useSourceMonitorState((state) => state.setZoomLevel);
  const setZoomPan = useSourceMonitorState((state) => state.setZoomPan);

  function changeZoomLevel(value: string) {
    setZoomPan({ x: 0, y: 0 });
    if (value === "fit") {
      setZoomLevel("fit");
      return;
    }
    setZoomLevel(Number(value));
  }

  const zoomOptions = ["fit", ...baseZoomPercentOptions] as MonitorZoomLevel[];
  const zoomValue = zoomLevel === "fit" ? "fit" : String(zoomLevel);
  const zoomLabel = zoomLevel === "fit" ? "适合" : `${zoomLevel}%`;
  const zoomItems: Array<SelectDropdownItem<string>> = zoomOptions.map((value) => ({
    type: "option",
    value: String(value),
    label: value === "fit" ? "适合" : `${value}%`,
  }));
  const fitZoomItemIndex = zoomItems.findIndex(
    (item) => item.type === "option" && item.value === "fit",
  );
  if (fitZoomItemIndex >= 0) {
    zoomItems.splice(fitZoomItemIndex + 1, 0, { type: "separator" });
  }
  return (
    <SelectDropdown
      className="monitor-select"
      menuClassName="monitor-select-menu"
      value={zoomValue}
      selectedLabel={zoomLabel}
      items={zoomItems}
      onChange={changeZoomLevel}
    />
  );
}
