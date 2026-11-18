/** Consume a drag's release click. A new interaction ends suppression if no click arrives. */
export function suppressReleaseClick(owner: { current: (() => void) | null }) {
  owner.current?.();
  const release = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", release, true);
    window.removeEventListener("keydown", release, true);
    window.removeEventListener("blur", release);
    if (owner.current === release) owner.current = null;
  };
  const swallow = (event: MouseEvent) => {
    release();
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", release, true);
  window.addEventListener("keydown", release, true);
  window.addEventListener("blur", release);
  owner.current = release;
}
