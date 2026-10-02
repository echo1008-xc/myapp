import Ionicons from '@expo/vector-icons/Ionicons';
import { Alert, Pressable, Text, View } from 'react-native';
import { Tabs } from 'expo-router';
import { colors } from '../../lib/theme';

// 应用名「糖Gi可De」每个字的固定配色（2026-09-29 用户定）：糖=红 / Gi=橙 / 可=蓝 / De=绿。
// 用在导航栏大标题上（首页顶部那行彩色字）。
const APP_NAME: { ch: string; color: string }[] = [
  { ch: '糖', color: '#E5484D' },
  { ch: 'Gi', color: '#F2994A' },
  { ch: '可', color: '#4DA6FF' },
  { ch: 'De', color: '#2FA84F' },
];

function ColoredAppName({ size }: { size: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: '700' }}>
      {APP_NAME.map((c) => (
        <Text key={c.ch} style={{ color: c.color }}>{c.ch}</Text>
      ))}
    </Text>
  );
}

// 底部标签栏。现在是 5 个位置（2026-09-29 用户要求从 3 个扩到 5 个）：
//   糖Gi可De | 记录 | 餐前拍 | 趋势图 | 关于
// 「餐前拍」钉在正中间（2026-09-29 傍晚定）—— 所以换位时别动它，它是第 3 个。
//
// 顺序小史：
//   · 09-29 起「待定」(tbd1) 占第 2 位、「记录」(tbd2) 占第 4 位（29 日晚定：记录往右挪）。
//   · 2026-10-02 用户要求换回来：记录移到第 2 位，待定移到第 4 位并改名「趋势图」。
//     → 现在就是上面那行：index | tbd2 | meal | tbd1 | settings。
// ⚠️ 只换 <Tabs.Screen> 的**书写先后**就能换标签位置（expo-router 按书写顺序排）。
//    不要为了换位去改文件名！文件名换了等于换页面，历史记录、路由全乱。
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.sub,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '糖Gi可De',
          // 顶部大标题「糖Gi可De」：每个字 1.5 倍字号、各用各的彩色（2026-09-29 用户要求）。
          //   糖=红 / Gi=橙 / 可=淡蓝 / De=绿；字号 30（原来的 1.5 倍）。
          //   彩色标题左边是「三条杠」键（2026-09-29 加）：首页常用的自我介绍键，
          //   点一下弹 App 的自我介绍。灰色小字「饮食自律向导」用 headerRight
          //   钉在导航栏右边（marginRight 16 —— 曲屏最右一字会显示不全）。
          // 用自定义 headerTitle 渲染（title 仍保留给底部标签栏 + _name_test.js 第 2 组）。
          headerTitle: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                hitSlop={8}
                onPress={() =>
                  Alert.alert(
                    '糖Gi可De',
                    '饮食自律向导。\n\n拍下每一餐，看清热量与碳水 —— Everything may be decrease! 一切皆可降！'
                  )
                }
              >
                <Ionicons name="menu" size={24} color={colors.text} style={{ marginRight: 8 }} />
              </Pressable>
              <ColoredAppName size={30} />
            </View>
          ),
          headerRight: () => (
            <Text
              style={{
                fontSize: 15,
                fontWeight: '400',
                color: colors.sub,
                marginRight: 16,
              }}
            >
              饮食自律向导
            </Text>
          ),
          tabBarIcon: ({ color, size }) => <Ionicons name="list" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tbd2"
        options={{
          // 2026-10-02：挪到第 2 位（原来第 4 位），和「待定」对调。
          //   图标沿用书本/记录（reader-outline）—— 它页里就是月历+那天详情，
          //   书本比别的都贴切，就不动了。
          title: '记录',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="reader-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="meal"
        options={{
          title: '餐前拍',
          tabBarIcon: ({ color, size }) => <Ionicons name="camera" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tbd1"
        options={{
          // 2026-10-02：从「待定」改名「趋势图」，位置挪到第 4 位。
          //   图标从问号换成折线 —— 名字已经是正经功能了，别再挂个问号。
          //   ⚠️ 折线必须**朝下**（2026-10-02 用户定：「不能上升，折线反一下向下」）。
          //     App 是控糖减糖的，血糖该往下走；用上升箭头等于给"涨糖"点赞，意思反了。
          title: '趋势图',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trending-down-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '关于',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
