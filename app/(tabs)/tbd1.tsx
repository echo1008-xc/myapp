import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { readLog, type MealLogEntry } from '../../lib/meal/log';
import { isDaySlotsComplete } from '../../lib/meal/slots';
import { dailyTarget, readProfile, type Target } from '../../lib/profile';
import { today } from '../../lib/date';
import { colors, radius, space } from '../../lib/theme';
// 两条线的颜色也在这儿取（图例和小圆点用），别在界面里再抄一遍色号
import {
  buildTrendPoints,
  buildTrendRange,
  CAL_COLOR,
  CARB_COLOR,
  labelEveryFor,
  monthDates,
  weekDates,
  type TrendPoint,
} from '../../lib/meal/trend';
import { TrendChart } from '../../components/TrendChart';

// ============================================================
// 「趋势图」页（2026-10-02 由「待定」占位页换上来）
// ============================================================
// 用户原话：「横轴是时间，左边竖轴是总热量、右边是总碳水，个人的目标画成横线标出来，
// 每天的做出曲线来对照 —— 上面一幅过去 7 天、下面一幅过去 30 天。」
//
// 数据全部来自账本（lib/meal/log.ts），目标全部来自「我的目标」（lib/profile.ts），
// 两处都不自己造数 —— 在「目标」页改了数字，这里跟着动。
//
// ⚠️ 没记录的那天不给点（TrendPoint 里省掉 calories/carb），
//    图上表现为**线跨过缺口直接连**，不是掉一个坑到 0。

export default function Tbd1() {
  const [entries, setEntries] = useState<MealLogEntry[]>([]);
  const [target, setTarget] = useState<Target | null>(null);

  // ⚠️ 两张卡的口径是**联动**的（艾可 10-02 定的规矩）：只有这一个开关，
  //    点上面卡头，下面卡跟着一起换；点下面卡头，上面卡也跟着一起换 —— 绝不各切各的。
  //    rolling = 按天数看：上面「过去 7 天」、下面「过去 30 天」
  //    period  = 按周月看：上面「本周」、下面「本月」（两张卡同一档，对齐）
  // ⚠️ 切到「本周 / 本月」之后横轴**排满一整段**（周一~周日 / 1 号~月末），
  //    今天之后还没到的日子留空位：线画到今天为止就停住，不补假点往前拖。
  const [scope, setScope] = useState<'rolling' | 'period'>('rolling');
  const toggleScope = () => setScope((s) => (s === 'rolling' ? 'period' : 'rolling'));

  // 每次回到这一页都重读：刚拍完一餐退回来，曲线要立刻长出来。
  useFocusEffect(() => {
    void (async () => {
      const [all, profile] = await Promise.all([readLog(), readProfile()]);
      setEntries(all);
      setTarget(profile ? dailyTarget(profile) : null);
    })();
    // ⚠️ 这里**不许**传第二个参数（deps）：expo-router 这个 hook 的第二个参数
    //    就是 `never`，传了编译直接报。它本来就是"每次拿到焦点都跑一遍"，
    //    而我们要的正是这个（退回来就重读账本）。
  });

  const todayIso = today();

  // ⚠️ 今天三餐**没记齐**就不上曲线（2026-10-02 定的规矩，见 log.ts 里 isDaySlotsComplete）。
  //    饭还没吃完 / 只记了一两餐，把这天画上去，"总热量"当然是残缺的，
  //    折线看着像掉了一大截 —— 不属实的图比难看的图更糟。
  //    所以这天整条（连同它那个坑位）一起从取数里摘掉，图就到此为止。
  //    中间某天一整天没记不算这条规矩的适用范围：那照旧是缺口，线从上面跨过去。
  const pool = useMemo(
    () => (isDaySlotsComplete(entries, todayIso) ? entries : entries.filter((e) => e.date !== todayIso)),
    [entries, todayIso],
  );

  // 上面卡：rolling = 今天往回数 7 天（横轴两端 = 起始日 / 今日）
  //         period = 本周一 ~ 周日（**7 格全排**，今天之后还没到的日子留空位）
  const d7 = useMemo(
    () =>
      scope === 'rolling'
        ? buildTrendPoints(pool, 7, todayIso)
        : buildTrendRange(pool, weekDates(todayIso)[0], weekDates(todayIso)[6]),
    [pool, todayIso, scope],
  );
  // 下面卡：rolling = 今天往回数 30 天（横轴两端 = 30 天前 / 今日）
  //         period = 1 号 ~ 月末（**整月全排**，今天之后留空位）
  const d30 = useMemo(
    () =>
      scope === 'rolling'
        ? buildTrendPoints(pool, 30, todayIso)
        : buildTrendRange(pool, monthDates(todayIso)[0], monthDates(todayIso).slice(-1)[0]),
    [pool, todayIso, scope],
  );
  const hasAny = entries.length > 0;

  // 卡头两个词：当前生效的居中加黑，另一个吊在右上角当"可以换的那个"。
  const topShown = scope === 'rolling' ? '过去 7 天' : '本周';
  const topOther = scope === 'rolling' ? '本周' : '过去 7 天';
  const botShown = scope === 'rolling' ? '过去 30 天' : '本月';
  const botOther = scope === 'rolling' ? '本月' : '过去 30 天';

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      {/* 上面一幅（点卡头任一个词 → 两张卡一起换口径） */}
      <View style={styles.card}>
        <ModeTabs shown={topShown} other={topOther} onSwap={toggleScope} />
        <Legend />
        <TrendChart
          points={d7}
          calTarget={target?.calories}
          carbTarget={target?.carb}
          labelEvery={labelEveryFor(d7.length)}
          xAxis={scope === 'rolling' ? 'rolling' : 'week'}
        />
        <Foot points={d7} total={d7.length} />
      </View>

      {/* 下面一幅 */}
      <View style={styles.card}>
        <ModeTabs shown={botShown} other={botOther} onSwap={toggleScope} />
        <Legend />
        <TrendChart
          points={d30}
          calTarget={target?.calories}
          carbTarget={target?.carb}
          labelEvery={labelEveryFor(d30.length)}
          xAxis={scope === 'rolling' ? 'rolling' : 'month'}
          height={180}
          dotSize={4}
        />
        <Foot points={d30} total={d30.length} />
      </View>

      {hasAny ? null : <Text style={styles.empty}>还没有记录 —— 拍一餐，这里就有曲线了。</Text>}
    </ScrollView>
  );
}

// 卡头那一行：**当前生效的那个词摆正中间、加黑**；
//             另一个词（可以换的那个）缩小、搁在**右上角**。
// 两个词都能点 —— 摸到哪个就换一档（见上面 toggleScope：两张卡一起换）。
// ⚠️ 不加任何「点这里切换」的提示文字（2026-09-24 定的：界面极简，看法自己就会）。
function ModeTabs({ shown, other, onSwap }: { shown: string; other: string; onSwap: () => void }) {
  return (
    <View style={styles.tabs}>
      <TouchableOpacity
        style={styles.tabsShown}
        onPress={onSwap}
        activeOpacity={0.5}
        accessibilityRole="button"
        accessibilityLabel={shown}
      >
        <Text style={styles.tabOn}>{shown}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.tabsOther}
        onPress={onSwap}
        activeOpacity={0.5}
        accessibilityRole="button"
        accessibilityLabel={other}
      >
        <Text style={styles.tabOff}>{other}</Text>
      </TouchableOpacity>
    </View>
  );
}

// 图例：两条线各是什么、量的是哪个单位。
// ⚠️ 只写「总热量（千卡）/ 总碳水（克）」，不写「左轴 / 右轴」（2026-10-02 去掉的）：
//    哪边是哪条，看图就明白（左槽是黄橙的数、右槽是蓝的数），不用再拿话解释一遍。
function Legend() {
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: CAL_COLOR }]} />
        <Text style={styles.legendText}>总热量（千卡）</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: CARB_COLOR }]} />
        <Text style={styles.legendText}>总碳水（克）</Text>
      </View>
    </View>
  );
}

// 图底下那一行小字：有几天记录、平均多少。
// ⚠️ 「几天超目标」那两条（热量 N 天超目标 / 碳水 N 天超目标）**不写了**
//    （2026-10-02 按艾可要求去掉）：哪几天压到基准线上面，图上一眼就看得出来，
//    再拿一行小字重复一遍是废话，还让两幅卡的说明变长。
function Foot({ points, total }: { points: TrendPoint[]; total: number }) {
  const st = useMemo(() => {
    const withData = points.filter((p) => typeof p.calories === 'number');
    const n = withData.length;
    if (n === 0) return null;
    const avgCal = Math.round(withData.reduce((s, p) => s + (p.calories ?? 0), 0) / n);
    const avgCarb = Math.round(withData.reduce((s, p) => s + (p.carb ?? 0), 0) / n);
    return { n, avgCal, avgCarb };
  }, [points]);

  if (!st) return <Text style={styles.foot}>这 {total} 天里还没有记录。</Text>;

  return (
    <Text style={styles.foot}>
      共 {st.n}/{total} 天有记录 · 均值 {st.avgCal} 千卡 / {st.avgCarb} 克
    </Text>
  );
}

// 取数那一层在 lib/meal/trend.ts 的 buildTrendPoints 里（同一处算，方便单独跑断言）。

const styles = StyleSheet.create({
  pad: {
    paddingLeft: space.md,
    paddingRight: space.md,
    paddingTop: space.sm,
    paddingBottom: space.xl, // 别贴着屏幕最底下那条边
    gap: space.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.sm,
    gap: 6,
  },
  // 卡头那一行：当前生效的词居中（下面 push 到 middle），可换的词贴右上角
  tabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingLeft: 2,
  },
  tabsShown: {
    flex: 1, // 占掉剩下宽度，好让另一个词自然靠到最右边
    alignItems: 'center', // 当前生效的这个词 → 水平居中
    paddingTop: 1,
  },
  tabsOther: {
    paddingTop: 3, // 跟居中那个的字面对齐（小字字号小，得多压一点才齐）
    paddingLeft: 8,
  },
  // 当前生效的这个：只比右边那个**略微深一点**（2026-10-02 艾可调过的）——
  // 一开始用了 800 的粗黑，他嫌太显眼，降回跟原来左右排时一样的 700/13 号。
  tabOn: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  // 另一个：更小更浅，看着像"没选中但能点"
  tabOff: {
    fontSize: 11,
    color: colors.sub,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  swatch: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    color: colors.sub,
  },
  foot: {
    fontSize: 11,
    color: colors.sub,
  },
  empty: {
    fontSize: 13,
    color: colors.sub,
    textAlign: 'center',
    paddingVertical: space.lg,
  },
});
