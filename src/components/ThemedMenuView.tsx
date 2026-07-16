import { MenuView, type MenuComponentProps, type MenuComponentRef } from '@expo/ui/community/menu';
import type { Ref } from 'react';

export type { MenuAction, MenuComponentProps, MenuComponentRef, NativeActionEvent } from '@expo/ui/community/menu';

type Props = MenuComponentProps & {
  ref?: Ref<MenuComponentRef>;
};

/** Non-iOS: stock MenuView (Compose / web). Theme issue is iOS form-sheet only. */
export function ThemedMenuView(props: Props) {
  return <MenuView {...props} />;
}
