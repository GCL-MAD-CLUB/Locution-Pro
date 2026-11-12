export function initScrollMotion() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const stories = [
    ...document.querySelectorAll(
      ".product-story, .local-section, .faq-section, .download-section, .support-section",
    ),
  ];
  const hero = document.querySelector(".hero");
  const heroCopy = hero?.querySelector(".hero-copy");
  const header = document.querySelector(".site-header");
  const main = document.querySelector("main");
  const footer = document.querySelector(".site-footer");
  let frame = 0;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  function update() {
    frame = 0;
    if (reducedMotion.matches) return;
    const height = window.innerHeight;
    for (const story of stories) {
      const rect = story.getBoundingClientRect();
      // Reveal a whole spread once, so scrolling back never hides its controls.
      if (rect.top < height * 0.88) story.classList.add("is-revealed");
    }
    header?.classList.toggle("is-scrolled", window.scrollY > 8);
    if (heroCopy) {
      // Progress of the first screen leaving the viewport drives the hand-off to the preview.
      const rect = heroCopy.getBoundingClientRect();
      hero.style.setProperty("--hero-exit", String(clamp(-rect.top / rect.height)));
    }
    if (main && footer) {
      const bottom = main.getBoundingClientRect().bottom;
      footer.style.setProperty(
        "--footer-reveal",
        String(clamp((height - bottom) / Math.min(height, footer.offsetHeight))),
      );
    }
  }
  function schedule() {
    if (!frame && !reducedMotion.matches) frame = requestAnimationFrame(update);
  }
  function sync() {
    document.documentElement.classList.toggle("motion-ready", !reducedMotion.matches);
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      hero?.classList.remove("hero-entering");
    } else update();
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  reducedMotion.addEventListener("change", sync);
  sync();
  if (hero && !reducedMotion.matches && hero.getBoundingClientRect().bottom > 0) {
    hero.classList.add("hero-entering");
    hero.addEventListener("animationend", (event) => {
      if (event.animationName === "hero-preview-in") hero.classList.remove("hero-entering");
    });
  }
}
