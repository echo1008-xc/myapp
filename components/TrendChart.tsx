import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import {
  CAL_COLOR,
  CARB_COLOR,
  computeTrendGeom,
  PAD_L,
  type TrendGeom,
  type TrendPoint,
  type TrendXAxis,
} from '../lib/meal/trend';

// ============================================================
// 趋势图：横轴 = 日期，左边竖轴 = 总热量（千卡），右边竖轴 = 总碳水（克）
// ============================================================
// 两条线各用**自己的一把尺子**（双 Y 轴）：热量一两千、碳水一百多，
// 塞在同一把尺子上碳水会被压成一条贴底的直线，所以必须两条轴。
//
// 坐标怎么算全在 `lib/meal/trend.ts`（纯加减乘除、能单独跑断言），
// 这里只管**摆方块**：线 = 一段按角度转过的细长条，点 = 圆角小方块，
// 网格/目标线 = 一根横条。
//
// ⚠️ 两个刻意的决定，说清楚免得以后被「修」掉：
//   ① **纵轴一定从 0 起**，不从「最小值」起。从中间起能把几天的差别放大好几倍，
//      控糖 app 里那会骗人（看着像在掉，其实只差 20 千卡）。
//   ② **没记录的那天不画点**，线从缺口上直接跨过去连。
//   ③ 要先量出真宽度（onLayout）才画线段：线段靠**像素长度**去旋转，
//      光有百分比算不出长度。量到之前这一段不画，量到了自动补上。
//   ④ 目标虚线上**不挂小方块**（2026-10-02 去掉的）：两条虚线各自的数，
//      直接标在自己那把尺子的外槽上（左槽黄橙、右槽蓝），颜色跟线一致就够了。

type Props = {
  points: TrendPoint[]; // 按日期升序（老的在前）。缺的那天留个只带 date 的空位
  calTarget?: number; // 目标热量（千卡）。不传 = 不画这条横线
  carbTarget?: number; // 目标碳水（克）。不传 = 不画
  height?: number; // 整块图的高度，默认 170
  labelEvery?: number; // 底部日期每隔几格写一次：7 天图传 1，30 天图传 5
  dotSize?: number; // 圆点直径，默认 5
  xAxis?: TrendXAxis; // 横轴怎么标：rolling=起始日/今日，month=整月两端写日期，week=整周首尾带星期
};

export function TrendChart({
  points,
  calTarget,
  carbTarget,
  height = 170,
  labelEvery = 1,
  dotSize = 5,
  xAxis = 'rolling',
}: Props) {
  const [w, setW] = useState(0); // 这块图量出来的真宽度

  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    if (width > 0) setW(width);
  };

  const g = computeTrendGeom({ points, width: w, height, calTarget, carbTarget, labelEvery, xAxis });
  const r = dotSize / 2;

  // 两条目标横线各自落在哪条横线上：两把尺子量程不同（热量两三千、碳水一百多），
  // 所以同一条横线上左端的数和右端的数不一样 —— 两个目标各判各的。
  const tg = g ? targetInfo(g, calTarget, carbTarget) : null;

  return (
    <View style={[styles.root, { height }]} onLayout={onLayout}>
      {g ? (
        <View style={StyleSheet.absoluteFill}>
          {/* ---- 网格 + 左右两把尺子的数字 ---- */}
          {g.ticks.map((t) => {
            const hitCal = !t.zero && tg?.calOnGrid === true && Math.abs(t.y - (tg.calY ?? 0)) < 11;
            const hitCarb =
              !t.zero && tg?.carbOnGrid === true && Math.abs(t.y - (tg.carbY ?? 0)) < 11;
            return (
              <View key={`g${t.f}`}>
                <View
                  style={[styles.gridLine, { top: round(t.y), width: g.plotW, left: PAD_L }]}
                />
                {/* 基线（0）两端不写数字：横轴两端改由下面的日期说明，写 0 反而看着像「0 和 0」 */}
                {t.zero ? null : (
                  <Text
                    style={[
                      styles.axisVal,
                      { top: round(t.y) - 7 },
                      hitCal ? styles.axisValHit : null,
                      hitCal ? { color: CAL_COLOR } : null,
                    ]}
                  >
                    {t.cal}
                  </Text>
                )}
                {t.zero ? null : (
                  <Text
                    style={[
                      styles.axisValRight,
                      { top: round(t.y) - 7 },
                      hitCarb ? styles.axisValHit : null,
                      hitCarb ? { color: CARB_COLOR } : null,
                    ]}
                  >
                    {t.carb}
                  </Text>
                )}
              </View>
            );
          })}

          {/* ---- 两条目标横线：只有一根虚线，不挂小方块 ---- */}
          {tg && tg.calY !== null ? (
            <TargetLine y={tg.calY} left={PAD_L} width={g.plotW} color={CAL_COLOR} />
          ) : null}
          {tg && tg.carbY !== null ? (
            <TargetLine y={tg.carbY} left={PAD_L} width={g.plotW} color={CARB_COLOR} />
          ) : null}

          {/* ---- 两条虚线各在自己那把尺子（左边热量 / 右边碳水）上挂一个本色刻度 ---- */}
          {tg && tg.calY !== null && !tg.calOnGrid ? (
            <TargetTick
              y={tg.calY}
              color={CAL_COLOR}
              value={Math.round(calTarget as number)}
              side="start"
            />
          ) : null}
          {tg && tg.carbY !== null && !tg.carbOnGrid ? (
            <TargetTick
              y={tg.carbY}
              color={CARB_COLOR}
              value={Math.round(carbTarget as number)}
              side="end"
            />
          ) : null}

          {/* ---- 总热量（橙）、总碳水（蓝）各一条折线 ---- */}
          {g.segsCal.map(renderSeg)}
          {g.segsCarb.map(renderSeg)}
          {g.dotsCal.map((d) => renderDot(d, r))}
          {g.dotsCarb.map((d) => renderDot(d, r))}

          {/* ---- 底部日期 ---- */}
          {g.marks.map((m) => (
            <Text key={m.key} style={[styles.dateMark, { transform: [{ translateX: m.x - 17 }] }]}>
              {m.text}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

// 两条目标虚线各落在哪条横线上（两把尺子量程不同，所以是两个不同的高度）。
// 目标值**正好压在某条网格线上 11 像素以内**时（calOnGrid / carbOnGrid），
// 那个位置本来就有数字了 —— 轴上只把它染成线色加粗，不再多挂一个刻度数字，免得叠字。
function targetInfo(g: TrendGeom, calTarget?: number, carbTarget?: number) {
  const calY = typeof calTarget === 'number' && calTarget > 0 ? g.yAt(calTarget, g.calMax) : null;
  const carbY = typeof carbTarget === 'number' && carbTarget > 0 ? g.yAt(carbTarget, g.carbMax) : null;
  const onGrid = (y: number | null) =>
    y === null ? false : g.ticks.some((t) => Math.abs(t.y - y) < 11);
  return { calY, carbY, calOnGrid: onGrid(calY), carbOnGrid: onGrid(carbY) };
}

const renderSeg = (s: { key: string; left: number; top: number; len: number; deg: number; color: string }) => (
  <View
    key={s.key}
    style={{
      position: 'absolute',
      left: s.left,
      top: s.top,
      width: s.len,
      height: 2,
      borderRadius: 1,
      backgroundColor: s.color,
      transform: [{ rotate: `${s.deg}deg` }],
    }}
  />
);

const renderDot = (d: { key: string; x: number; y: number; color: string }, r: number) => (
  <View
    key={d.key}
    style={{
      position: 'absolute',
      left: d.x - r,
      top: d.y - r,
      width: r * 2,
      height: r * 2,
      borderRadius: r,
      backgroundColor: d.color,
    }}
  />
);

// 一条目标横线：就一根虚线，**不挂「目标 2250」那种小方块**
// （2026-10-02 去掉的 —— 两个小方块叠在两张一样的图上，看着像图例又像标签，
//   线在哪、值多少，靠轴上的那个本色刻度数字说明就够了）。
function TargetLine({
  y,
  left,
  width,
  color,
}: {
  y: number;
  left: number;
  width: number;
  color: string;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        left,
        top: round(y),
        width,
        height: 0,
        borderTopWidth: 1,
        borderStyle: 'dashed',
        borderTopColor: color,
      }}
    />
  );
}

// 目标虚线在**自己那把尺子**上挂的一个数值提醒：本色加粗数字。
// side=start → 挂在左槽（热量那把尺子），side=end → 挂在右槽（碳水）。
// ⚠️ 这里**只放数字，不画任何短线/小方块**（2026-10-02 改的）：
//    早先在起点端加了一小截 2px 高的实心块当"刻度"，结果起点那一截明显比虚线本身粗，
//    两条目标线看着都像"头大身子小"。线要**从头到尾一样**，所以只留数字。
function TargetTick({
  y,
  color,
  value,
  side,
}: {
  y: number;
  color: string;
  value: number;
  side: 'start' | 'end';
}) {
  return (
    <Text
      style={[
        side === 'end' ? styles.axisValRight : styles.axisVal,
        { top: round(y) - 7, color, fontWeight: '700' },
      ]}
    >
      {value}
    </Text>
  );
}

// 别让小数点跑进 style 里（数越小越容易被对齐到 0）
const round = (n: number) => Math.round(n * 10) / 10;

const styles = StyleSheet.create({
  root: {
    width: '100%',
  },
  gridLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: colors.line,
  },
  axisVal: {
    position: 'absolute',
    left: 0,
    width: 29, // PAD_L − 5
    textAlign: 'right',
    fontSize: 9,
    color: colors.sub,
  },
  axisValRight: {
    position: 'absolute',
    right: 0,
    width: 25, // PAD_R − 5
    textAlign: 'left',
    fontSize: 9,
    color: colors.sub,
  },
  // 目标值正好压在网格线上时，把这个数字加粗（颜色另外染色）
  axisValHit: {
    fontWeight: '700',
  },
  dateMark: {
    position: 'absolute',
    bottom: 3,
    width: 34,
    textAlign: 'center',
    fontSize: 9,
    color: colors.sub,
  },
});
