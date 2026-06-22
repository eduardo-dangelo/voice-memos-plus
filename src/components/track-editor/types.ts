export type EditorTool = 'trim' | 'move' | 'volume' | 'reverb' | 'delay' | 'eq';

export const EDITOR_TOOLS: {
  id: EditorTool;
  label: string;
  symbol:
    | 'scissors'
    | 'arrow.left.and.right'
    | 'speaker.wave.2.fill'
    | 'dot.radiowaves.left.and.right'
    | 'clock.arrow.2.circlepath'
    | 'slider.horizontal.3';
}[] = [
  { id: 'trim', label: 'Trim', symbol: 'scissors' },
  { id: 'move', label: 'Move', symbol: 'arrow.left.and.right' },
  { id: 'volume', label: 'Volume', symbol: 'speaker.wave.2.fill' },
  { id: 'reverb', label: 'Reverb', symbol: 'dot.radiowaves.left.and.right' },
  { id: 'delay', label: 'Delay', symbol: 'clock.arrow.2.circlepath' },
  { id: 'eq', label: 'EQ', symbol: 'slider.horizontal.3' },
];

export const EDITOR_CANVAS_HEIGHT = 132;
export const EDITOR_CANVAS_HEIGHT_REVERB = 148;
export const EDITOR_CANVAS_HEIGHT_DELAY = 188;
export const EDITOR_STRIP_HEIGHT = 56;

export function getEditorCanvasHeight(tool: EditorTool | null): number {
  if (!tool || tool === 'trim' || tool === 'move') {
    return 0;
  }
  switch (tool) {
    case 'reverb':
      return EDITOR_CANVAS_HEIGHT_REVERB;
    case 'delay':
      return EDITOR_CANVAS_HEIGHT_DELAY;
    default:
      return EDITOR_CANVAS_HEIGHT;
  }
}
