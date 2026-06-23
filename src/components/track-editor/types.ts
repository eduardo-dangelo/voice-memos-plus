import type { LayerEffects } from '@/src/audio/layerEffects';

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
export const EDITOR_CANVAS_HEIGHT_VOLUME = 78;
export const EDITOR_CANVAS_HEIGHT_REVERB = 148;
export const EDITOR_CANVAS_HEIGHT_REVERB_COMPACT = 50;
export const EDITOR_CANVAS_HEIGHT_DELAY = 200;
export const EDITOR_CANVAS_HEIGHT_DELAY_COMPACT = 50;
export const EDITOR_CANVAS_HEIGHT_EQ = 208;
export const EDITOR_CANVAS_HEIGHT_EQ_COMPACT = 50;
export const EDITOR_STRIP_HEIGHT = 56;

export function getEditorCanvasHeight(tool: EditorTool | null, effects?: LayerEffects): number {
  if (!tool || tool === 'trim' || tool === 'move') {
    return 0;
  }
  switch (tool) {
    case 'reverb':
      return effects?.reverb.preset === 'custom'
        ? EDITOR_CANVAS_HEIGHT_REVERB
        : EDITOR_CANVAS_HEIGHT_REVERB_COMPACT;
    case 'delay':
      return effects?.delay.preset === 'custom'
        ? EDITOR_CANVAS_HEIGHT_DELAY
        : EDITOR_CANVAS_HEIGHT_DELAY_COMPACT;
    case 'volume':
      return EDITOR_CANVAS_HEIGHT_VOLUME;
    case 'eq':
      return effects?.eq.preset === 'custom'
        ? EDITOR_CANVAS_HEIGHT_EQ
        : EDITOR_CANVAS_HEIGHT_EQ_COMPACT;
    default:
      return EDITOR_CANVAS_HEIGHT;
  }
}
