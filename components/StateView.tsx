import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ScreenState } from '../lib/store/useTasks';
import { colors, radius, space } from '../lib/theme';

type Props = {
  state: ScreenState;
  children: ReactNode;
  message?: string;
  emptyText?: string;
  onRetry?: () => void;
};

// 四态外壳：加载中转圈、出错给重试按钮、空数据给一句人话、成功才显示内容。
// 每个新页面都套一层它，就不会出现「白屏，用户不知道该干嘛」。
export function StateView({ state, children, message, emptyText, onRetry }: Props) {
  if (state === 'success') {
    return <>{children}</>;
  }

  const isError = state === 'error';

  return (
    <View style={styles.wrap}>
      {state === 'loading' ? (
        <>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.hint}>正在加载…</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{isError ? '加载失败' : '还没有任务'}</Text>
          <Text style={styles.hint}>{isError ? message : emptyText}</Text>
          {isError && onRetry ? (
            <Pressable style={styles.button} onPress={onRetry}>
              <Text style={styles.buttonText}>重试</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  hint: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.sub,
    textAlign: 'center',
  },
  button: {
    marginTop: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});
