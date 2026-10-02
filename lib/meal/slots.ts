// ============================================================
// 三餐的「齐不齐」判定（纯函数，不碰界面、不碰存储）
// ============================================================
// 为什么要单开一个小文件：趋势图要用它决定**今天**上不上曲线，而曲线那半边
// （lib/meal/trend.ts）是刻意不碰存储、能单独编译跑断言的。放这儿两边都能用，
// 谁都不用背对方的依赖。
//
// ⚠️ 参数故意写成这么小的形状（`{ date; slot }[]`）而不是 MealLogEntry：
//    这样账本那边的完整类型传进来照样兼容，又不用在这里 import 账本 —— 免得循环依赖。

export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

// 遍历三餐时用这个常量，别到处手写数组（少写一个就少算一餐，这种错很难发现）。
export const SLOT_KEYS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];

export type DayEntryLite = { date: string; slot: string };

// 这一天「三餐都记到了」没有（早/中/晚各至少一条）。
//
// ⚠️ 趋势图靠它决定**今天**上不上曲线（2026-10-02 定的）：
//    今天饭还没吃完、或早中晚只记了其中一两餐，那天的「总热量/总碳水」是不属实的
//    （少记一餐，数字当然低），折线看着像往下掉了 —— 假的好看比难看的更糟。
//    所以**不齐就整天空掉这天，一个点都不画**（缺口只发生在中间那天，收尾这天不同）。
export function isDaySlotsComplete(all: DayEntryLite[], date: string): boolean {
  return SLOT_KEYS.every((k) => all.some((e) => e.date === date && e.slot === k));
}
