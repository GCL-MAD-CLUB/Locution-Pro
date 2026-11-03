import { findActiveSection, findSnapTarget } from "./scroll.js";

const queryExamples = {
  coast: {
    query: "“黄昏时的海岸线”",
    label: "山间海岸",
    results: [
      { title: "海岸 / 远景", image: "official-shot-coast.webp", alt: "海岸与远山的官方视觉示意" },
      {
        title: "山脊 / 黄昏",
        image: "official-shot-mountain.webp",
        alt: "山峦与海面的官方视觉示意",
      },
      { title: "城市 / 入夜", image: "official-shot-city.webp", alt: "月夜城市的官方视觉示意" },
    ],
  },
  city: {
    query: "“入夜后的城市轮廓”",
    label: "城市夜景",
    results: [
      { title: "城市 / 月夜", image: "official-shot-city.webp", alt: "月夜城市的官方视觉示意" },
      {
        title: "海岸 / 蓝调时刻",
        image: "official-shot-coast.webp",
        alt: "蓝紫色海岸的官方视觉示意",
      },
      { title: "远山 / 暮色", image: "official-shot-mountain.webp", alt: "暮色山峦的官方视觉示意" },
    ],
  },
  mountain: {
    query: "“旷野尽头的远山”",
    label: "旷野远山",
    results: [
      { title: "山峦 / 远景", image: "official-shot-mountain.webp", alt: "层叠山峦的官方视觉示意" },
      { title: "海岸 / 山脊", image: "official-shot-coast.webp", alt: "海岸山脊的官方视觉示意" },
      { title: "城市 / 山脚", image: "official-shot-city.webp", alt: "山脚下的城市视觉示意" },
    ],
  },
};

const queryText = document.querySelector("#query-text");
const resultsContainer = document.querySelector("#search-results");
const resultCount = document.querySelector("#result-count");
const searchStatus = document.querySelector("#search-status");
const queryButtons = document.querySelectorAll(".query-option");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let updateTimer;
let currentQuery = "coast";

function renderQuery(key) {
  const example = queryExamples[key];
  if (!example || key === currentQuery) return;
  currentQuery = key;

  window.clearTimeout(updateTimer);
  queryButtons.forEach((button) => {
    const isActive = button.dataset.query === key;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  queryText.textContent = example.query;
  resultsContainer.classList.add("is-updating");
  resultsContainer.setAttribute("aria-busy", "true");

  updateTimer = window.setTimeout(
    () => {
      const cards = resultsContainer.querySelectorAll(".search-result");
      cards.forEach((card, index) => {
        const result = example.results[index];
        const image = card.querySelector("img");
        image.src = `./assets/${result.image}`;
        image.alt = result.alt;
        card.querySelector("h3").textContent = result.title;
      });
      resultCount.textContent = `${String(example.results.length).padStart(2, "0")} 个视觉参考`;
      searchStatus.textContent = `已切换到${example.label}示例，显示三幅官方视觉参考画面。`;
      resultsContainer.classList.remove("is-updating");
      resultsContainer.setAttribute("aria-busy", "false");
    },
    reducedMotion.matches ? 0 : 160,
  );
}

queryButtons.forEach((button) => {
  button.addEventListener("click", () => renderQuery(button.dataset.query));
});

const progressBar = document.querySelector(".reading-progress");
const header = document.querySelector(".site-header");
const mobileMenu = document.querySelector(".mobile-menu");
const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
const sections = [...document.querySelectorAll("main > section")];
const motionQuery = window.matchMedia("(pointer: fine) and (min-width: 960px)");
let scrollFrame = 0;
let layoutFrame = 0;
let activeSection = "";
let sectionPositions = [];
let headerHeight = 73;
let previousPosition = window.scrollY;
let scrollDirection = 0;
let settleTimer;
let snapTimer;
let manualScroll = false;
let pointerDown = false;
let snapping = false;

function updateScrollUI() {
  scrollFrame = 0;
  const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
  const progress = scrollRange > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollRange)) : 0;
  progressBar.style.transform = `scaleX(${progress})`;
  const nextSection = findActiveSection(
    sectionPositions,
    window.scrollY,
    headerHeight,
    window.innerHeight,
  );

  if (nextSection !== activeSection) {
    activeSection = nextSection;
    navLinks.forEach((link) => {
      if (link.getAttribute("href") === `#${activeSection}`) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }
}

function requestScrollUI() {
  if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollUI);
}

function measureLayout() {
  layoutFrame = 0;
  const measuredHeight = Math.ceil(header.getBoundingClientRect().height);
  if (headerHeight !== measuredHeight) {
    headerHeight = measuredHeight;
    document.documentElement.style.setProperty("--header-height", `${headerHeight}px`);
  }
  sectionPositions = sections.map((section) => ({
    id: section.id,
    top: section.getBoundingClientRect().top + window.scrollY,
  }));
  requestScrollUI();
}

function requestLayout() {
  if (!layoutFrame) layoutFrame = window.requestAnimationFrame(measureLayout);
}

function cancelSnap() {
  window.clearTimeout(settleTimer);
  window.clearTimeout(snapTimer);
  if (snapping) window.scrollTo({ top: window.scrollY, behavior: "instant" });
  snapping = false;
}

function settleScroll() {
  if (
    !manualScroll ||
    snapping ||
    pointerDown ||
    reducedMotion.matches ||
    !motionQuery.matches ||
    mobileMenu.open ||
    document.hidden ||
    !window.getSelection()?.isCollapsed ||
    document.activeElement?.closest("input, textarea, select, summary, [contenteditable], dialog")
  )
    return;

  manualScroll = false;
  const target = findSnapTarget(
    sectionPositions.map((section) => section.top),
    {
      position: window.scrollY,
      direction: scrollDirection,
      viewportHeight: window.innerHeight,
      headerHeight,
    },
  );
  if (target === null) return;
  snapping = true;
  window.scrollTo({ top: target, behavior: "smooth" });
  snapTimer = window.setTimeout(() => {
    snapping = false;
  }, 600);
}

function armScroll() {
  cancelSnap();
  manualScroll = true;
}

window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) armScroll();
  },
  { passive: true },
);
window.addEventListener(
  "touchstart",
  () => {
    pointerDown = true;
    armScroll();
  },
  { passive: true },
);
window.addEventListener(
  "touchend",
  () => {
    pointerDown = false;
  },
  { passive: true },
);
window.addEventListener(
  "touchcancel",
  () => {
    pointerDown = false;
    manualScroll = false;
    cancelSnap();
  },
  { passive: true },
);
window.addEventListener(
  "pointerdown",
  () => {
    pointerDown = true;
    cancelSnap();
  },
  { passive: true },
);
window.addEventListener(
  "pointerup",
  () => {
    pointerDown = false;
  },
  { passive: true },
);
window.addEventListener(
  "pointercancel",
  () => {
    pointerDown = false;
    manualScroll = false;
    cancelSnap();
  },
  { passive: true },
);
window.addEventListener("keydown", (event) => {
  if (
    ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " "].includes(event.key) &&
    !event.target.closest("button, a, summary, input, textarea, select, [contenteditable]")
  )
    armScroll();
  if (["Home", "End", "Escape"].includes(event.key)) {
    manualScroll = false;
    cancelSnap();
  }
  if (event.key === "Escape" && mobileMenu.open) {
    mobileMenu.open = false;
    mobileMenu.querySelector("summary").focus();
  }
});
window.addEventListener(
  "scroll",
  () => {
    const difference = window.scrollY - previousPosition;
    if (manualScroll && !snapping && Math.abs(difference) > 0.5)
      scrollDirection = Math.sign(difference);
    previousPosition = window.scrollY;
    requestScrollUI();
    window.clearTimeout(settleTimer);
    if (manualScroll && !snapping) settleTimer = window.setTimeout(settleScroll, 180);
  },
  { passive: true },
);

document.addEventListener("click", (event) => {
  const anchor = event.target.closest('a[href^="#"]');
  if (anchor) {
    manualScroll = false;
    cancelSnap();
    mobileMenu.open = false;
  } else if (!mobileMenu.contains(event.target)) mobileMenu.open = false;
});

document.addEventListener("toggle", requestLayout, true);
window.addEventListener("resize", () => {
  manualScroll = false;
  cancelSnap();
  if (window.innerWidth >= 960) mobileMenu.open = false;
  requestLayout();
});
window.addEventListener("hashchange", () => {
  manualScroll = false;
  cancelSnap();
});
if ("ResizeObserver" in window) {
  const layoutObserver = new ResizeObserver(requestLayout);
  [header, ...sections].forEach((element) => layoutObserver.observe(element));
}
document.fonts.ready.then(requestLayout);
measureLayout();

const revealItems = document.querySelectorAll("[data-reveal]");
if (!reducedMotion.matches && "IntersectionObserver" in window) {
  document.documentElement.classList.add("reveal-ready");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  revealItems.forEach((item) => revealObserver.observe(item));
  reducedMotion.addEventListener("change", (event) => {
    if (!event.matches) return;
    document.documentElement.classList.remove("reveal-ready");
    revealObserver.disconnect();
    revealItems.forEach((item) => item.classList.add("is-visible"));
  });
}

reducedMotion.addEventListener("change", () => {
  manualScroll = false;
  cancelSnap();
  requestLayout();
});
