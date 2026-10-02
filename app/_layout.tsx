import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import UpdateSheet from '../components/UpdateSheet';
import { colors } from '../lib/theme';
import { checkForUpdate } from '../lib/update/checker';
import { getSkippedVersionCode } from '../lib/update/skip';
import type { ReleaseInfo } from '../lib/update/types';

// 启动后隔多久去问云端"有没有新版本"。留 1.5 秒是先让首屏画出来，
// 不然一开 App 就弹窗，观感很差（而且此刻网络请求还没必要抢在主界面之前）。
const CHECK_DELAY_MS = 1500;

// 全 App 的外壳。所有页面的顶部导航条样式在这里统一设定。
export default function RootLayout() {
  // 有新版才不是 null；为 null 时弹窗自然不显示，不用额外开关变量。
  const [release, setRelease] = useState<ReleaseInfo | null>(null);

  // 每次冷启动检查一次更新。查不到 / 报错都安静跳过，绝不打扰用户。
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await checkForUpdate();
        if (cancelled || result.status !== 'available') {
          return;
        }
        // 这个版本用户点过「稍后」就不再打扰；强制更新的除外。
        const skipped = await getSkippedVersionCode();
        if (cancelled) {
          return;
        }
        if (!result.release.force && skipped === result.release.versionCode) {
          return;
        }
        setRelease(result.release);
      })();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // 全 App 默认锁竖屏。
  // 为什么需要这一步：app.json 里把方向改成了 default（允许旋转），
  // 那是为了让「看大图」时能把手机转成横屏用；但别的页面都没做横屏适配，
  // 所以在最外层统一锁回竖屏，只有看大图那个弹层会临时解锁
  // （见 app/(tabs)/meal.tsx 里的 openViewer / closeViewer）。
  useEffect(() => {
    void (async () => {
      try {
        // 按需加载：万一某个旧安装包里没有这个原生模块，也只是锁不住方向，
        // 不会让整个 App 白屏。
        const mod = await import('expo-screen-orientation');
        await mod.lockAsync(mod.OrientationLock.PORTRAIT_UP);
      } catch {
        // 锁不住就算了，不影响正常使用
      }
    })();
  }, []);

  return (
    // 全 App 的手势根。手势库要求所有手势都必须待在它里面才能生效；
    // 全屏看图那个弹层是独立的一层窗口、管不到，所以在弹层里又包了一层。
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="task/[id]" options={{ title: '任务详情' }} />
        {/* 首页最上面那条「目标」点进来的就是这一页：填年龄身高体重，算出每天该吃多少。
            标题跟首页那条保持一致，只叫「目标」（2026-09-26 晚：原来叫「我的目标」）。 */}
        <Stack.Screen name="target" options={{ title: '目标' }} />
        {/* 「当天」页（点记录页日历里的某一天进去看那天吃了什么）。
            ⚠️ 它**不能**放在 app/(tabs)/ 里 —— 那个目录底下每个文件都会被
            自动算成底部栏目的一页，底栏就会凭空多出一个「day」按钮
            （2026-10-01 用户就在真机上看到最右边多了一格）。
            放在 (tabs) 外面当普通二级页走栈，就不会占底栏。 */}
        <Stack.Screen name="day" options={{ title: '当天' }} />
      </Stack>

      <UpdateSheet
        visible={release !== null}
        release={release}
        onClose={() => setRelease(null)}
      />
    </GestureHandlerRootView>
  );
}
