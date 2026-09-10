const PRIMED_ATTRIBUTE = 'data-spike-cursor-primed';

/**
 * Existing client surfaces already declare `cursor: pointer` in their local
 * styles. This bridge preserves that authority and translates the computed
 * pointer state into the shared primed cursor without maintaining a second
 * catalogue of clickable CSS classes.
 */
export function installSpikeCursorDomBridge(
  root: Document,
  enabled: () => boolean,
): () => void {
  let active: HTMLElement | null = null;

  const clear = () => {
    active?.removeAttribute(PRIMED_ATTRIBUTE);
    active = null;
  };
  const onPointerOver = (event: PointerEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (active !== target) clear();
    if (!target || !enabled()) return;
    if (root.defaultView?.getComputedStyle(target).cursor !== 'pointer') return;
    target.setAttribute(PRIMED_ATTRIBUTE, '');
    active = target;
  };
  const onPointerOut = (event: PointerEvent) => {
    const current = active;
    if (!current) return;
    if (event.target !== current) return;
    const related = event.relatedTarget;
    if (related instanceof Node && current.contains(related)) return;
    clear();
  };

  root.addEventListener('pointerover', onPointerOver);
  root.addEventListener('pointerout', onPointerOut);
  return () => {
    root.removeEventListener('pointerover', onPointerOver);
    root.removeEventListener('pointerout', onPointerOut);
    clear();
  };
}
