// A small forward correction after manual scrolling, never a jump to another screen.
export function findSnapTarget(points, { position, direction, viewportHeight, headerHeight }) {
  if (!direction || viewportHeight <= headerHeight) return null;
  const threshold = Math.min(56, Math.max(20, (viewportHeight - headerHeight) * 0.065));
  const candidates = points
    .map((top) => Math.max(0, top - headerHeight))
    .filter((target) => {
      const distance = (target - position) * Math.sign(direction);
      return distance > 2 && distance <= threshold;
    });
  return candidates.sort((a, b) => Math.abs(a - position) - Math.abs(b - position))[0] ?? null;
}

export function findActiveSection(sections, position, headerHeight, viewportHeight) {
  const readingLine = position + headerHeight + Math.max(0, viewportHeight - headerHeight) * 0.28;
  return sections.findLast((section) => section.top <= readingLine)?.id ?? sections[0]?.id ?? "";
}
