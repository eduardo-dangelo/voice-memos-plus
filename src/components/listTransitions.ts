import { Easing, FadeIn, FadeInDown, FadeOut, FadeOutUp, LinearTransition } from 'react-native-reanimated';

export const LIST_ITEM_TRANSITION = LinearTransition.duration(220).easing(
  Easing.bezier(0.33, 0, 0.2, 1)
);

export const LIST_ITEM_ENTER = FadeIn.duration(180);

export const LIST_ITEM_EXIT = FadeOut.duration(180);

/** Waveform track stack — longer fade+slide so add/remove reads clearly. */
export const TRACK_ROW_ENTER = FadeInDown.duration(280);

export const TRACK_ROW_EXIT = FadeOutUp.duration(220);
