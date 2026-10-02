import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../lib/theme';

// 访问了不存在的路径时显示这个页面，而不是一片空白。
export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: '页面不存在' }} />
      <View style={styles.wrap}>
        <Text style={styles.title}>这个页面不存在</Text>
        <Link href="/" style={styles.link}>
          回到首页
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  link: {
    fontSize: 14,
    color: colors.accent,
  },
});
