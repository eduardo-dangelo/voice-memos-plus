export type EditorTool = 'trim' | 'move' | 'volume' | 'pan' | 'reverb' | 'delay' | 'eq';

export const EDITOR_TOOLS: {
  id: EditorTool;
  label: string;
  symbol:
    | 'scissors'
    | 'arrow.left.and.right'
    | 'speaker.wave.2.fill'
    | 'hifispeaker.2'
    | 'dot.radiowaves.left.and.right'
    | 'clock.arrow.2.circlepath'
    | 'slider.horizontal.3';
}[] = [
  { id: 'trim', label: 'Trim', symbol: 'scissors' },
  { id: 'move', label: 'Move', symbol: 'arrow.left.and.right' },
  { id: 'volume', label: 'Volume', symbol: 'speaker.wave.2.fill' },
  { id: 'pan', label: 'Pan', symbol: 'hifispeaker.2' },
  { id: 'reverb', label: 'Reverb', symbol: 'dot.radiowaves.left.and.right' },
  { id: 'delay', label: 'Delay', symbol: 'clock.arrow.2.circlepath' },
  { id: 'eq', label: 'EQ', symbol: 'slider.horizontal.3' },
];

export const EDITOR_CANVAS_HEIGHT = 132;
export const EDITOR_CANVAS_HEIGHT_VOLUME = 78;
export const EDITOR_CANVAS_HEIGHT_REVERB_COMPACT = 50;
export const EDITOR_CANVAS_HEIGHT_DELAY_COMPACT = 50;
export const EDITOR_CANVAS_HEIGHT_EQ_COMPACT = 50;
export const EDITOR_CANVAS_HEIGHT_MOVE_COMPACT = 50;
export const EDITOR_STRIP_HEIGHT = 56;

export function getEditorCanvasHeight(tool: EditorTool | null): number {
  if (!tool) {
    return 0;
  }
  switch (tool) {
    case 'trim':
      return 0;
    case 'move':
      return EDITOR_CANVAS_HEIGHT_MOVE_COMPACT;
    case 'reverb':
      return EDITOR_CANVAS_HEIGHT_REVERB_COMPACT;
    case 'delay':
      return EDITOR_CANVAS_HEIGHT_DELAY_COMPACT;
    case 'volume':
    case 'pan':
      return EDITOR_CANVAS_HEIGHT_VOLUME;
    case 'eq':
      return EDITOR_CANVAS_HEIGHT_EQ_COMPACT;
    default:
      return EDITOR_CANVAS_HEIGHT;
  }
}
