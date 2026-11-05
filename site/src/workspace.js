export function initWorkspaceCarousel() {
  const carousel = document.querySelector(".workspace-carousel");
  if (!carousel) return;

  const slides = [...carousel.querySelectorAll(".workspace-slide")];
  const choices = [...carousel.querySelectorAll("[data-workspace-choice]")];
  const status = carousel.querySelector("#workspace-status");
  const landscape = window.matchMedia("(orientation: landscape)");
  const dialog = document.querySelector(".workspace-dialog");
  const dialogImage = dialog.querySelector(".workspace-dialog-image");
  const dialogTitle = dialog.querySelector("#workspace-dialog-title");
  let activeIndex = 1;
  let touchStart = null;
  let suppressClickUntil = 0;

  function select(index, announce = true) {
    activeIndex = landscape.matches ? (index + slides.length) % slides.length : 1;
    slides.forEach((slide, slideIndex) => {
      const offset = (slideIndex - activeIndex + slides.length) % slides.length;
      slide.dataset.position = ["center", "right", "left"][offset];
      slide.tabIndex = offset === 0 ? 0 : -1;
      slide.setAttribute(
        "aria-label",
        offset === 0
          ? `查看${slide.dataset.label}工作区完整截图`
          : `切换到${slide.dataset.label}工作区`,
      );
    });
    choices.forEach((choice, index) => {
      choice.setAttribute("aria-pressed", String(index === activeIndex));
    });
    if (announce) status.textContent = `当前展示${slides[activeIndex].dataset.label}工作区`;
  }

  dialog.querySelector(".workspace-dialog-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("workspace-dialog-open");
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    dialog.querySelector(".workspace-dialog-close").focus();
  });

  slides.forEach((slide, index) => {
    slide.setAttribute("aria-haspopup", "dialog");
    slide.setAttribute("aria-controls", dialog.id);
    slide.addEventListener("click", (event) => {
      event.preventDefault();
      if (Date.now() < suppressClickUntil) {
        return;
      }
      if (!landscape.matches || index === activeIndex) {
        const image = slide.querySelector("img");
        dialogImage.src = image.src;
        dialogImage.alt = image.alt;
        dialogTitle.textContent = `${slide.dataset.label}工作区`;
        dialog.showModal();
        document.documentElement.classList.add("workspace-dialog-open");
        return;
      }
      select(index);
      slides[activeIndex].focus({ preventScroll: true });
    });
  });
  choices.forEach((choice, index) => choice.addEventListener("click", () => select(index)));
  carousel.querySelectorAll("[data-workspace-step]").forEach((button) => {
    button.addEventListener("click", () => {
      select(activeIndex + Number(button.dataset.workspaceStep));
    });
  });
  carousel.addEventListener("keydown", (event) => {
    if (!landscape.matches || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const slideFocused = event.target.closest(".workspace-slide");
    select(activeIndex + step);
    if (slideFocused) slides[activeIndex].focus({ preventScroll: true });
  });

  const viewport = carousel.querySelector(".workspace-viewport");
  viewport.addEventListener(
    "touchstart",
    (event) => {
      touchStart = event.touches.length === 1 ? event.touches[0] : null;
    },
    { passive: true },
  );
  viewport.addEventListener(
    "touchend",
    (event) => {
      if (!touchStart || !landscape.matches) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStart.clientX;
      const dy = touch.clientY - touchStart.clientY;
      touchStart = null;
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      suppressClickUntil = Date.now() + 500;
      select(activeIndex + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );
  viewport.addEventListener(
    "touchcancel",
    () => {
      touchStart = null;
    },
    { passive: true },
  );
  landscape.addEventListener("change", () => {
    touchStart = null;
    select(1, false);
    status.textContent = "";
  });
  select(1, false);
  carousel.classList.add("is-ready");
}
