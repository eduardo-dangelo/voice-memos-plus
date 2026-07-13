import { Easing, FadeOut, LinearTransition } from 'react-native-reanimated';

export const LIST_ITEM_TRANSITION = LinearTransition.duration(220).easing(
  Easing.bezier(0.33, 0, 0.2, 1)
);

export const LIST_ITEM_EXIT = FadeOut.duration(180);
