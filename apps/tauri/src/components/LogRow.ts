import { defineComponent, type PropType, type SlotsType, type VNode } from 'vue';

/**
 * Perf (JLeav 1.0.296, owner "option 2"): one Log row as its own component instance, so a new log line renders only
 * the new row. The row MARKUP stays in SpectateView's `<pre>` as this component's default slot (its scoped CSS and the
 * pre's literal whitespace keep working; slot content is compiled in the view's scope), and this component renders that
 * slot as its own root: no wrapper element, no fragment anchors, so the DOM and the log's text are exactly as before.
 *
 * Why it skips: the slot reads only its slot props (never the view's v-for variables), so Vue compiles it STABLE and a
 * parent re-render patches this row only when a prop changed identity. The view passes row objects that keep their
 * identity across recomputes (logRowStability.ts). Everything else the row reads (settings, the seat tint, the pitch
 * view) is read while THIS component renders, so its own render effect tracks it and the row follows those changes
 * without a dependency list.
 */
export type LogRowSlotProps = { entry: any; plate: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- the view's row types, read in its template

export default defineComponent({
  name: 'LogRow',
  props: {
    /** The row (a log entry, an expanded Graphical row, or a FUMBBL-style row): identity-stable while unchanged. */
    entry: { type: Object as PropType<any>, required: true }, // eslint-disable-line @typescript-eslint/no-explicit-any
    /** The Graphical style's action plate for this row (logRowPlates; identity-stable). */
    plate: { type: Object as PropType<any>, default: undefined }, // eslint-disable-line @typescript-eslint/no-explicit-any
  },
  slots: Object as SlotsType<{ default: LogRowSlotProps }>,
  setup(props, { slots }) {
    return (): VNode | VNode[] | null => {
      const nodes = slots.default?.({ entry: props.entry, plate: props.plate }) ?? [];
      return nodes.length === 1 ? nodes[0]! : nodes;
    };
  },
});
