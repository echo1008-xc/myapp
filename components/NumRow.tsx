import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { colors, space } from '../lib/theme';

/* ============================================================
   一套「行头 + 数字组」的网格，首页「目标 / 今日 / 早中晚」和
   记录页「看哪一天 / 总热量 / 早中晚」**共用同一份**。

   为什么抽成共用组件（2026-10-01）：
   这两处原来各写一份，记录页那块写的是「右边竖排两句话」
   （总热量 620 千卡 / 总碳水 80 克，各占一行），
   看着就「不像首页」—— 而且早中晚三行的热量、碳水列根本对不齐。
   首页那套是**三段一组**（说明 / 数字 / 单位），
   组与组之间那道大间隔**不写死像素**，而是整行唯一的 `flex: 1`（spacer），
   所以「同一列上下对齐」是结构上保证的，不是靠眼睛调出来的。
   一份代码 = 两个页面长得一模一样，改一处两边一起变。

   ── 一组的三段各自怎么站（改这里前先读）──
   ① 说明（总热量 / 热量）靠右 `textAlign: 'right'`，
      让它**贴着自己的数字**。靠左的话 2 个字的"热量"后面会白空 20 像素
      —— 那正是用户说的"类名和数字之间间隔太大"。
   ② 数字 —— 只占一个小格子（minWidth）**而且靠右**，
      位数不同也往同一个右边缘堆。格子只留够 4 位（热量）/ 3 位（碳水），
      富余一律不给它。
   ③ 单位 —— 紧跟数字，只留 3 像素。
   ④ 单位（千卡 / 克）永不换行、永不压缩：`flexShrink: 0` 锁死，
      挤不下就宁可把左边的说明压一压。

   ⚠️ 别给组内任何一段加 flex。一加，富余就会漏进组内，
      两组又会糊在一起（这条有守卫：`_grid_test.js` 第 5 组）。
   ============================================================ */

type Tone = 'warn' | 'over' | 'danger' | null;

type NumCellProps = {
  /** 组里的说明：总热量 / 总碳水 / 热量 / 碳水 */
  prefix: string;
  value: number;
  unit: string;
  /** 「目标」「今日」那几行用主色 */
  accent?: boolean;
  /** 碳水那一列少一位数，数字格给窄一点 */
  narrow?: boolean;
  /** 超标警告色（今日合计超目标时用） */
  tone?: Tone;
};

// ★ 一组三段。返回的是**三个兄弟 Text**，**别在外面包一层 View**：
//   ① 它们必须平铺在同一个 row 容器里，宽度才互相约束得住；
//   ② `alignItems: 'baseline'` 对 Text 才稳，隔着 View 就不一定。
//   "组"这个概念只靠样式表达（说明靠右 + 数字格 + 大间隔），不靠嵌套。
export function NumCell({ prefix, value, unit, accent, narrow, tone }: NumCellProps) {
  // 三段都要锁成一行，一个都不能漏：折行会让这一行比别的行高，上下对齐全白做。
  // 警告色放数组后面 —— RN 里后面的样式覆盖前面的，超标时盖过 accent 主色。
  const s: StyleProp<TextStyle> = [
    accent ? styles.accent : null,
    tone === 'warn' ? styles.toneWarn : null,
    tone === 'over' ? styles.toneOver : null,
    tone === 'danger' ? styles.toneDanger : null,
  ];
  return (
    <>
      <Text style={[styles.prefix, s]} numberOfLines={1}>
        {prefix}
      </Text>
      <Text style={[narrow ? styles.numNarrow : styles.num, s]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.unit, s]} numberOfLines={1}>
        {unit}
      </Text>
    </>
  );
}

// 一行。行头 + 若干数组，平铺排列、按文字基线对齐。
export function GridRow({ tap = false, children }: { tap?: boolean; children?: ReactNode }) {
  return <View style={[styles.row, tap && styles.rowTap]}>{children}</View>;
}

// 行头（目标 / 今日 / 早餐 / 晚餐，或者记录页顶上那个数字日期）。
// ★ 固定宽 46：行头宽度不参与后面的列位计算，所以各行的「热量」「碳水」
//   永远落在同一条竖线上，不用为每一行的行头单独调像素。
export function GridLabel({
  accent = false,
  children,
}: {
  accent?: boolean;
  children?: ReactNode;
}) {
  return (
    <Text style={[styles.label, accent && styles.labelAccent]} numberOfLines={1}>
      {children}
    </Text>
  );
}

// 组与组之间那道大间隔。整行**唯一**的 flex:1。
// minWidth 是保底：万一某行挤到极限（系统字体调得很大、或者屏幕更窄），
// 宁可把内容往右挤出去一点，也绝不让「千卡」和「总碳水」贴在一起 ——
// 贴在一起正是用户 9/27 凌晨提的毛病，这里就是它的最后一道防线。
export function GridSpacer() {
  return <View style={styles.spacer} />;
}

// 「还没设置」「还没拍」—— 占掉右边剩下的整块地方，次要灰。
export function GridNote({ children }: { children?: ReactNode }) {
  return (
    <Text style={[styles.note, styles.empty]} numberOfLines={1}>
      {children}
    </Text>
  );
}

export function GridDivider() {
  return <View style={styles.divider} />;
}

// 卡片最下面那行脚注（已记 3/3 餐 · 连续记录 N 天）。
export function GridFoot({ children }: { children?: ReactNode }) {
  return <Text style={styles.foot}>{children}</Text>;
}

const styles = StyleSheet.create({
  // 行头那两个字的格子：marginRight 是「行头 → 第一组」那道固定缝
  // （2026-09-29 用户要求过三倍，实测挤不下退回两倍）。
  // 这道缝固定像素，不占中间的 flex 大间隔，所以每一行都跟着右移、照样对齐。
  label: {
    width: 46,
    marginRight: space.lg + space.xs,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  // 行头加粗只用在「目标 / 今日 / 9.29」这几行，
  // 用来和下面早中晚拉开层次。两个字 ≈34px < 46 的格子，加粗不改变任何列的位置。
  labelAccent: {
    color: colors.accent,
    fontWeight: '600',
  },
  // 组里的说明。用 minWidth 而不是 width：万一句换成更长的词，
  // 宁可这一行宽一点，也不要被截成"总热…"。
  // ★ textAlign 'right' 是关键：让说明贴着自己的数字。
  prefix: {
    minWidth: 44,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
  },
  // 数字格（热量列）：留够 4 位数的位子，靠右堆。
  // 真机实测细体 1 位数字 ≈8.5px、4 位 ≈34，36 留 2px 余量 ——
  // 卡太死「总热量1530」会粘成一个词（9/29 真机教训）。
  num: {
    minWidth: 36,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // 数字格（碳水列）：少一位数，格子窄一点（3 位 ≈26 + 余量），组内更紧。
  numNarrow: {
    minWidth: 30,
    textAlign: 'right',
    fontSize: 13,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  // 单位（千卡 / 克）。宽度随字数走，但同一列永远是同一个词，各行的位置天然一致。
  unit: {
    marginLeft: 3,
    fontSize: 13,
    color: colors.text,
  },
  // 「目标 / 今日 / 早中晚」几行的数字部分：只上主色，**不加粗**。
  // 加粗会把字撑宽（实测「总热量」粗体 ≈51px 超过 minWidth 44）→ 整列被顶偏，
  // 层次感由蓝色 + 行头加粗保住就够。
  accent: {
    color: colors.accent,
  },
  toneWarn: { color: '#EAB308' }, // 超出目标 ≤20%
  toneOver: { color: '#EA580C' }, // 超出 20%~50%
  toneDanger: { color: '#DC2626' }, // 超出 >50%
  // 可点的那几行上下留一点内边距：手指不至于老点偏到隔壁行。
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  rowTap: {
    paddingVertical: 4,
  },
  // ★ 组与组之间那道大间隔。整行唯一的 flex:1。
  spacer: {
    flex: 1,
    minWidth: 16,
  },
  note: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },
  // 「还没拍 / 还没设置」：次要灰 + 正常字重，一眼分得出哪些还空着。
  empty: {
    color: colors.sub,
    fontWeight: '400',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.line,
    marginVertical: 2,
  },
  foot: {
    fontSize: 11,
    color: colors.sub,
  },
});
