export function sectionSnapPoints(sections, viewportHeight, headerHeight, maxScroll = Infinity) {
  const available = viewportHeight - headerHeight;
  if (available <= 0) return [];
  return sections.flatMap((section) => {
    const fits = section.height <= available + 2;
    const point = (edge, top) => ({
      id: section.id,
      edge,
      fits,
      top: Math.round(Math.max(0, Math.min(maxScroll, top))),
    });
    return [
      point("start", section.top - headerHeight),
      ...(!fits ? [point("end", section.top + section.height - viewportHeight)] : []),
    ];
  });
}

// null delegates to native scrolling inside long content and throughout the footer.
export function findScrollTarget(
  sections,
  { position, delta, viewportHeight, headerHeight, maxScroll = Infinity },
) {
  if (!delta || viewportHeight <= headerHeight || !sections.length) return null;
  const points = sectionSnapPoints(sections, viewportHeight, headerHeight, maxScroll);
  const lastStart = points.findLast((point) => point.edge === "start").top;
  if (position > lastStart + 1) {
    return delta < 0 && position + delta <= lastStart ? lastStart : null;
  }
  if (position >= lastStart - 1 && delta > 0) return null;

  const current = sections.findLast((section) => section.top <= position + headerHeight + 1);
  if (current && current.height > viewportHeight - headerHeight + 2) {
    const start = points.find((point) => point.id === current.id && point.edge === "start").top;
    const end = points.find((point) => point.id === current.id && point.edge === "end").top;
    if (delta > 0 && position >= start - 1 && position < end - 1)
      return position + delta >= end ? end : null;
    if (delta < 0 && position > start + 1 && position <= end + 1)
      return position + delta <= start ? start : null;
  }
  return (
    (delta > 0
      ? points.find((point) => point.top > position + 1)
      : points.findLast((point) => point.top < position - 1)
    )?.top ?? null
  );
}

export function findActiveSection(sections, position, headerHeight, viewportHeight) {
  const readingLine = position + headerHeight + Math.max(0, viewportHeight - headerHeight) * 0.28;
  return sections.findLast((section) => section.top <= readingLine)?.id ?? sections[0]?.id ?? "";
}
