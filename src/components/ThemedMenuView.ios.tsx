import { requireNativeView } from 'expo';
import { useMemo, type ReactNode, type Ref } from 'react';

import { useColorScheme } from '@/components/useColorScheme';
import type {
  MenuAction,
  MenuComponentProps,
  MenuComponentRef,
  NativeActionEvent,
} from '@expo/ui/community/menu';
import { Button, Host, Menu, Section } from '@expo/ui/swift-ui';
import { UserInterfaceStyleView } from 'user-interface-style';

export type { MenuAction, MenuComponentProps, MenuComponentRef, NativeActionEvent };

type Props = MenuComponentProps & {
  ref?: Ref<MenuComponentRef>;
};

const RNHostNativeView: React.ComponentType<{
  matchContents?: boolean;
  children: React.ReactElement;
}> = requireNativeView('ExpoUI', 'RNHostView');

function actionId(action: MenuAction): string {
  return action.id ?? action.title;
}

function makeEvent(action: MenuAction): NativeActionEvent {
  return { nativeEvent: { event: actionId(action) } };
}

function renderAction(
  action: MenuAction,
  onPressAction: MenuComponentProps['onPressAction']
): ReactNode {
  if (action.attributes?.hidden) {
    return null;
  }

  const key = actionId(action);
  const systemImage = typeof action.image === 'string' ? action.image : undefined;

  if (action.subactions && action.subactions.length > 0) {
    const children = action.subactions.map((sub) => renderAction(sub, onPressAction));
    if (action.displayInline) {
      return (
        <Section key={key} title={action.title}>
          {children}
        </Section>
      );
    }
    return (
      <Menu key={key} label={action.title} systemImage={systemImage}>
        {children}
      </Menu>
    );
  }

  return (
    <Button
      key={key}
      label={action.title}
      systemImage={systemImage}
      role={action.attributes?.destructive ? 'destructive' : undefined}
      onPress={() => onPressAction?.(makeEvent(action))}
    />
  );
}

/**
 * Same SwiftUI Menu transitions as `@expo/ui` MenuView, but forces app theme
 * via UIKit `overrideUserInterfaceStyle` so native UIMenu chrome stays correct
 * inside form-sheet navigation headers (where trait inheritance resolves to light).
 * Host `colorScheme` still themes SwiftUI content.
 */
export function ThemedMenuView({
  actions,
  onPressAction,
  title,
  style,
  children,
  testID,
}: Props) {
  const colorScheme = useColorScheme();
  const hostColorScheme = colorScheme === 'dark' ? 'dark' : 'light';

  const body = useMemo(() => {
    const items = actions.map((action) => renderAction(action, onPressAction));
    return title ? <Section title={title}>{items}</Section> : items;
  }, [actions, onPressAction, title]);

  const trigger = (
    <RNHostNativeView matchContents>
      <>{children}</>
    </RNHostNativeView>
  );

  return (
    <UserInterfaceStyleView colorScheme={hostColorScheme} style={style}>
      <Host
        matchContents
        colorScheme={hostColorScheme}
        ignoreSafeArea="all"
        testID={testID}>
        <Menu label={trigger}>{body}</Menu>
      </Host>
    </UserInterfaceStyleView>
  );
}
