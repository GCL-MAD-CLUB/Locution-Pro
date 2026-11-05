import { findActiveSection, findScrollTarget, sectionSnapPoints } from "./scroll.js";

export function initSectionNavigation(reducedMotion) {
  const progressBar = document.querySelector(".reading-progress");
  const header = document.querySelector(".site-header");
  const mobileMenu = document.querySelector(".mobile-menu");
  const navLinks = [...document.querySelectorAll('nav a[href^="#"]')];
  const sections = [...document.querySelectorAll("main > section")];
  const desktop = window.matchMedia("(pointer: fine) and (min-width: 960px)");
  let sectionPositions = [];
  let headerHeight = 73;
  let viewportHeight = window.innerHeight;
  let activeSection = "";
  let layoutFrame = 0;
  let scrollFrame = 0;
  let animationFrame = 0;
  let destination = null;
  let pointerDown = false;
  let lastWheelTime = -Infinity;
  let wheelDirection = 0;
  let wheelHandled = false;
  let alignedAnchor = null;

  function points() {
    return sectionSnapPoints(
      sectionPositions,
      viewportHeight,
      headerHeight,
      Math.max(0, document.documentElement.scrollHeight - viewportHeight),
    );
  }

  function canControl() {
    return (
      desktop.matches &&
      !reducedMotion.matches &&
      !pointerDown &&
      !mobileMenu.open &&
      !document.hidden &&
      !document.querySelector("dialog[open]") &&
      window.getSelection()?.isCollapsed !== false &&
      !document.activeElement?.closest(
        "input, textarea, select, summary, [contenteditable], dialog",
      )
    );
  }

  function updateScrollUI() {
    scrollFrame = 0;
    alignedAnchor =
      sectionSnapPoints(sectionPositions, viewportHeight, headerHeight).find(
        (point) => point.fits && Math.abs(point.top - window.scrollY) <= 1,
      ) ?? null;
    const range = document.documentElement.scrollHeight - window.innerHeight;
    progressBar.style.transform = `scaleX(${range > 0 ? Math.min(1, Math.max(0, window.scrollY / range)) : 0})`;
    const next = findActiveSection(sectionPositions, window.scrollY, headerHeight, viewportHeight);
    if (next === activeSection) return;
    activeSection = next;
    navLinks.forEach((link) => {
      if (link.getAttribute("href") === `#${next}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }

  function requestScrollUI() {
    if (!scrollFrame) scrollFrame = window.requestAnimationFrame(updateScrollUI);
  }

  function measureLayout() {
    if (layoutFrame) window.cancelAnimationFrame(layoutFrame);
    layoutFrame = 0;
    const aligned =
      !destination && canControl()
        ? (sectionSnapPoints(sectionPositions, viewportHeight, headerHeight).find(
            (point) => point.fits && Math.abs(point.top - window.scrollY) <= 1,
          ) ?? (viewportHeight !== window.innerHeight ? alignedAnchor : null))
        : null;
    headerHeight = header.getBoundingClientRect().height;
    viewportHeight = window.innerHeight;
    document.documentElement.style.setProperty("--header-height", `${headerHeight}px`);
    sectionPositions = sections.map((section) => {
      const rect = section.getBoundingClientRect();
      return { id: section.id, top: rect.top + window.scrollY, height: rect.height };
    });
    if (aligned) {
      const point = points().find((point) => point.id === aligned.id && point.fits);
      if (point && Math.abs(point.top - window.scrollY) > 1)
        window.scrollTo({ top: point.top, behavior: "instant" });
    }
    requestScrollUI();
  }

  function requestLayout() {
    if (!layoutFrame) layoutFrame = window.requestAnimationFrame(measureLayout);
  }

  function cancelAnimation() {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    destination = null;
  }

  function releaseControl() {
    cancelAnimation();
    lastWheelTime = -Infinity;
    wheelDirection = 0;
    wheelHandled = false;
  }

  function animateTo(top) {
    const point = points().find((point) => point.top === top);
    if (!point || (destination?.id === point.id && destination?.edge === point.edge)) return;
    cancelAnimation();
    destination = point;
    const startPosition = window.scrollY;
    const startedAt = performance.now();
    const duration = Math.min(620, Math.max(280, Math.sqrt(Math.abs(top - startPosition)) * 18));
    function frame(now) {
      if (!canControl()) {
        releaseControl();
        return;
      }
      const current = points().find(
        (item) => item.id === destination?.id && item.edge === destination?.edge,
      );
      if (!current) {
        releaseControl();
        return;
      }
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
      window.scrollTo({
        top: startPosition + (current.top - startPosition) * eased,
        behavior: "instant",
      });
      if (progress < 1) animationFrame = window.requestAnimationFrame(frame);
      else {
        // Re-measure the destination before the final pixel alignment.
        measureLayout();
        const final = points().find(
          (item) => item.id === destination?.id && item.edge === destination?.edge,
        );
        if (final) window.scrollTo({ top: final.top, behavior: "instant" });
        cancelAnimation();
      }
    }
    animationFrame = window.requestAnimationFrame(frame);
  }

  function nestedScroll(target, direction) {
    for (
      let element = target;
      element instanceof Element && element !== document.body;
      element = element.parentElement
    ) {
      if (element === document.scrollingElement) break;
      if (!/(auto|scroll|overlay)/u.test(getComputedStyle(element).overflowY)) continue;
      const remaining = element.scrollHeight - element.clientHeight - element.scrollTop;
      if (direction > 0 ? remaining > 1 : element.scrollTop > 1) return true;
    }
    return false;
  }

  function targetFor(delta) {
    measureLayout();
    return findScrollTarget(sectionPositions, {
      position: window.scrollY,
      delta,
      viewportHeight,
      headerHeight,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - viewportHeight),
    });
  }

  window.addEventListener(
    "wheel",
    (event) => {
      if (
        event.defaultPrevented ||
        !event.cancelable ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      )
        return;
      if (!canControl() || nestedScroll(event.target, event.deltaY)) {
        releaseControl();
        return;
      }
      const now = performance.now();
      const direction = Math.sign(event.deltaY);
      const continuing = direction === wheelDirection && now - lastWheelTime < 200;
      lastWheelTime = now;
      wheelDirection = direction;
      if (
        (continuing && wheelHandled) ||
        (destination && Math.sign(destination.top - window.scrollY) === direction)
      ) {
        event.preventDefault();
        return;
      }
      wheelHandled = false;
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? viewportHeight - headerHeight : 1);
      const target = targetFor(delta);
      if (target === null) {
        cancelAnimation();
        return;
      }
      event.preventDefault();
      wheelHandled = true;
      animateTo(target);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu.open) {
      mobileMenu.open = false;
      mobileMenu.querySelector("summary").focus();
    }
    if (["Home", "End", "Escape", "Tab"].includes(event.key)) {
      releaseControl();
      return;
    }
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      !canControl() ||
      !["ArrowDown", "ArrowUp", "PageDown", "PageUp", " "].includes(event.key) ||
      event.target.closest("button, a, summary, input, textarea, select, [contenteditable], dialog")
    )
      return;
    const direction =
      ["ArrowUp", "PageUp"].includes(event.key) || (event.key === " " && event.shiftKey) ? -1 : 1;
    if (nestedScroll(event.target, direction)) {
      releaseControl();
      return;
    }
    if (event.repeat && destination) {
      event.preventDefault();
      return;
    }
    const target = targetFor(direction * (viewportHeight - headerHeight));
    if (target === null) {
      releaseControl();
      return;
    }
    event.preventDefault();
    animateTo(target);
  });

  window.addEventListener("scroll", requestScrollUI, { passive: true });
  for (const type of ["pointerdown", "touchstart"]) {
    window.addEventListener(
      type,
      () => {
        pointerDown = true;
        releaseControl();
      },
      { passive: true },
    );
  }
  for (const type of ["pointerup", "pointercancel", "touchend", "touchcancel"]) {
    window.addEventListener(
      type,
      () => {
        pointerDown = false;
      },
      { passive: true },
    );
  }
  window.addEventListener("blur", () => {
    pointerDown = false;
    releaseControl();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseControl();
  });
  document.addEventListener("click", (event) => {
    if (event.target.closest('a[href^="#"]')) {
      releaseControl();
      mobileMenu.open = false;
    } else if (!mobileMenu.contains(event.target)) mobileMenu.open = false;
  });
  document.addEventListener("toggle", requestLayout, true);
  window.addEventListener("hashchange", releaseControl);
  window.addEventListener("resize", () => {
    releaseControl();
    if (window.innerWidth >= 960) mobileMenu.open = false;
    requestLayout();
  });
  desktop.addEventListener("change", releaseControl);
  reducedMotion.addEventListener("change", () => {
    releaseControl();
    requestLayout();
  });
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(requestLayout);
    [header, ...sections].forEach((element) => observer.observe(element));
  }
  document.fonts.ready.then(requestLayout);
  measureLayout();
}
