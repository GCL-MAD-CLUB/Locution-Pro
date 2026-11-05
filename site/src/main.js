import { initSectionNavigation } from "./navigation.js";
import { initWorkspaceCarousel } from "./workspace.js";

initWorkspaceCarousel();

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

initSectionNavigation(reducedMotion);

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
