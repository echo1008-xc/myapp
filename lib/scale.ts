// 屏幕自适应小工具（2026-10-01 新建，目前**没有接进任何页面**）。
//
// 背景：整个 App 的间距/尺寸都是按「360 宽的主流安卓机」写死的固定 dp，
// 大部分还引用了 lib/theme.ts 里的 space（4/8/16/24/32）。这些固定值在你手上这台
// 360 宽的手机上看着刚好，换到 320 的小屏会挤爆、到 430 的大屏又显得局促。
//
// ⚠️ 别一股脑把所有数字乘个系数 —— 那会把「已经调好的层次」一起毁掉。
//    真正需要按屏缩放的只有两类：
//      ① 横向分栏里那些「卡死」的宽度（width / minWidth 固定值）
//      ② 大块容器的高度（照片框、图表框这种，写死 400 在窄屏就是竖长条）
//    纵向的小间距（padding 8、圆角 12、点击区高 44）**本来就是比例**，
//    dp 这个单位本身就是按屏幕密度算的，不用动。
//
// 用法（挑一种，不要混着用）：
//   const { sx, width } = useScale();          // 函数组件里
//   style={{ width: sxw(46, sx) }}             // 把「按 360 设计的 46」换算到当前屏
//   style={{ height: vw(0.62, width) }}        // 高度 = 屏宽的 62%（替代写死的 height）
import { useWindowDimensions } from 'react-native';

// 设计基准宽度。按 360 做的排版，其它屏宽按同一比例缩放。
const BASE_W = 360;
// 设计基准高度。纵向只在大屏才放大，小屏反而压一点，
// 保证小屏能一屏看完，不至于把所有东西都缩到看不清。
const BASE_H = 780;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/**
 * 当前屏幕的缩放系数。
 * 横向：320 屏 → 0.89，360 屏 → 1.00，430 屏 → 1.12（夹住上下限，避免大屏上控件大得离谱）。
 * 纵向：仅在比 780 明显高/矮的屏上微调，幅度比横向更保守。
 */
export function useScale(): { sx: number; sy: number; width: number; height: number } {
  const { width, height } = useWindowDimensions();
  return {
    sx: clamp(width / BASE_W, 0.88, 1.12),
    sy: clamp(height / BASE_H, 0.92, 1.1),
    width,
    height,
  };
}

/** 把「按 360 基准设计的横向尺寸」换算到当前屏宽。 */
export function sxw(v: number, sx: number): number {
  return Math.round(v * sx);
}

/**
 * 按屏宽比例取一个尺寸 —— 用来替代写死的 height。
 * 例：照片框 `height: vw(0.62, width)` 在 320 屏得 198、430 屏得 267，
 * 而不是无论多宽的屏都固定 400（窄屏上会变成一条竖长条）。
 */
export function vw(v: number, width: number): number {
  return Math.round(width * v);
}

/** 按比例分配一组横向空间（替代一排固定 width）。返回的是 flex 权重数组。 */
export function flexes(total: number, parts: number[]): number[] {
  const sum = parts.reduce((a, b) => a + b, 0) || 1;
  return parts.map((p) => Math.round((p / sum) * total * 100) / 100);
}
