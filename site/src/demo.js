const cycleDuration = 21000;
const fullView = [0, 0, 3120, 1940];
// Coordinates use the original application canvas so panels never reflow or drift.
const beats = [
  { at: 0, scene: "import", caption: "把素材汇集到项目。", pointer: [1450, 760], view: fullView },
  { at: 900, pointer: [1320, 480] },
  { at: 1500, selected: 1, click: true },
  { at: 2300, pointer: [1990, 480] },
  { at: 2900, selected: 2, click: true },
  { at: 3800, pointer: [3000, 1815] },
  { at: 4300, click: true },
  { at: 4700, scene: "edit", caption: "在分镜里，找到想保留的画面。", pointer: [2800, 90] },
  { at: 5500, pointer: [1350, 304], view: [1120, 140, 2000, 1244] },
  { at: 6200, search: "", click: true },
  { at: 6500, search: "分" },
  { at: 6750, search: "分镜" },
  { at: 7000, search: "分镜 156" },
  { at: 7500, result: true },
  { at: 8200, pointer: [1810, 540] },
  { at: 8700, click: true },
  {
    at: 9300,
    caption: "为镜头添加关键字，让下次查找更轻松。",
    pointer: [2580, 1374],
    view: [1900, 620, 1220, 759],
  },
  { at: 10300, keyword: true, click: true },
  { at: 11600, pointer: [2910, 90], view: fullView },
  { at: 12400, click: true },
  {
    at: 12800,
    scene: "export",
    caption: "核对片段范围与输出规格，准备交付。",
    pointer: [2200, 760],
  },
  { at: 13600, pointer: [1400, 552], view: [930, 145, 2190, 1362] },
  { at: 14400, menu: true, click: true },
  { at: 15100, pointer: [1400, 650] },
  { at: 15700, menu: false, format: true, click: true },
  { at: 17500, pointer: null, view: fullView },
];

function interpolate(from, to, amount) {
  return from.map((value, index) => value + (to[index] - value) * amount);
}

export function demoFrame(elapsed) {
  const time = elapsed % cycleDuration;
  const state = {
    selected: 0,
    search: null,
    result: false,
    keyword: false,
    menu: false,
    format: false,
  };
  let pointer = beats[0].pointer;
  let view = fullView;
  let clickAt = -Infinity;
  for (const beat of beats) {
    if (beat.at > time) break;
    if (beat.scene)
      Object.assign(state, {
        selected: 0,
        search: null,
        result: false,
        keyword: false,
        menu: false,
        format: false,
      });
    Object.assign(state, beat);
    if (beat.click) clickAt = beat.at;
  }
  // Move only after a beat starts; holds between actions give viewers time to read.
  for (const property of ["pointer", "view"]) {
    let previous = property === "pointer" ? beats[0].pointer : fullView;
    for (const beat of beats) {
      if (beat.at > time) break;
      if (!(property in beat)) continue;
      const target = beat[property];
      const progress = Math.min(1, (time - beat.at) / 620);
      const eased = 1 - (1 - progress) ** 3;
      const value = previous && target ? interpolate(previous, target, eased) : target;
      if (property === "pointer") pointer = value;
      else view = value;
      previous = target;
    }
  }
  return { ...state, pointer, view, clickProgress: Math.min(1, (time - clickAt) / 460) };
}

export function initAutomaticDemo() {
  document.querySelectorAll(".product-demo").forEach(initDemo);
}

function initDemo(demo) {
  const track = demo.dataset.demoTrack;
  const [start, duration] = { import: [0, 4600], edit: [4700, 7700], export: [12800, 8100] }[track];
  const canvas = demo.querySelector(".demo-canvas");
  const caption = demo.querySelector("[data-demo-caption]");
  const pointer = demo.querySelector("[data-demo-pointer]");
  const ring = demo.querySelector(".demo-click-ring");
  const playback = demo.querySelector(".demo-playback");
  const scenes = [...demo.querySelectorAll("[data-demo-scene]")];
  const layers = Object.fromEntries(
    [...demo.querySelectorAll("[data-demo-layer]")].map((layer) => [
      layer.dataset.demoLayer,
      layer,
    ]),
  );
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0;
  let frameId = 0;
  let lastTime = null;
  let visible = false;
  let paused = false;

  function render(frame) {
    demo.dataset.scene = frame.scene;
    for (const scene of scenes)
      scene.toggleAttribute("hidden", scene.dataset.demoScene !== frame.scene);
    layers["import-selection"].toggleAttribute("hidden", !frame.selected);
    layers["second-file"].toggleAttribute("hidden", frame.selected < 2);
    layers.search.toggleAttribute("hidden", frame.search === null);
    layers.result.toggleAttribute("hidden", !frame.result);
    layers.keyword.toggleAttribute("hidden", !frame.keyword);
    layers["format-menu"].toggleAttribute("hidden", !frame.menu);
    layers["format-value"].toggleAttribute("hidden", !frame.format);
    demo.querySelector("[data-demo-selection]").textContent = `已选择 ${frame.selected} 项`;
    demo.querySelector("[data-demo-query]").textContent = frame.search || "";
    if (caption.textContent !== frame.caption) caption.textContent = frame.caption;
    canvas.setAttribute("viewBox", frame.view.join(" "));
    pointer.toggleAttribute("hidden", !frame.pointer);
    if (frame.pointer) pointer.setAttribute("transform", `translate(${frame.pointer.join(" ")})`);
    ring.style.opacity = String(1 - frame.clickProgress);
    ring.setAttribute("r", String(12 + 38 * frame.clickProgress));
  }

  function staticPreview() {
    render({
      scene: track,
      selected: 0,
      search: null,
      result: false,
      keyword: false,
      menu: false,
      format: false,
      pointer: null,
      view: fullView,
      clickProgress: 1,
      caption: demoFrame(start).caption,
    });
  }

  function tick(time) {
    frameId = 0;
    if (lastTime !== null) elapsed += time - lastTime;
    lastTime = time;
    render(demoFrame(start + (elapsed % duration)));
    frameId = requestAnimationFrame(tick);
  }

  function syncPlayback() {
    cancelAnimationFrame(frameId);
    frameId = 0;
    lastTime = null;
    playback.hidden = reducedMotion.matches;
    const running = visible && !document.hidden && !paused && !reducedMotion.matches;
    demo.dataset.playing = String(running);
    playback.textContent = paused ? "继续" : "暂停";
    playback.setAttribute("aria-label", paused ? "继续自动演示" : "暂停自动演示");
    if (reducedMotion.matches) staticPreview();
    else if (running) frameId = requestAnimationFrame(tick);
  }

  playback.addEventListener("click", () => {
    paused = !paused;
    syncPlayback();
  });
  reducedMotion.addEventListener("change", syncPlayback);
  document.addEventListener("visibilitychange", syncPlayback);
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        syncPlayback();
      },
      { threshold: 0.15 },
    );
    observer.observe(demo);
  } else visible = true;
  staticPreview();
  syncPlayback();
}
