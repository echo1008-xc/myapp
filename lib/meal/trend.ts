import type { MealLogEntry } from './log';

// ============================================================
// 趋势图「算坐标」那一半（不含任何界面 —— 画图在 components/TrendChart.tsx）
// ============================================================
// 为什么要分开：算坐标全是加减乘除，跟界面没关系。拆出来就能**单独跑断言**
// （改坏了立刻知道），也不用为了测而把 React 组件塞进 node 里折腾。
// ⚠️ 这个文件里**不许 import 任何界面/存储库**：一旦碰了 React、AsyncStorage，
//    单独编译跑测试就会报"找不到模块"。要用 MealLogEntry 请用 `import type`（只存类型、编译后消失）。

// 一天的取值。⚠️ 那天**没记录**就只写 date，calories/carb 都省掉 ——
// 图上的线会从这个缺口上直接跨过去；要是填 0，就变成"这天吃了 0 千卡"，那是骗人。
export type TrendPoint = {
  date: string;
  calories?: number; // 千卡
  carb?: number; // 克
};

// 轴的留白（像素）。左右各留一条「数字槽」，底下留给日期。
export const PAD_L = 34; // 左：热量数字（如 2400）
export const PAD_R = 30; // 右：碳水数字（如 250）
export const PAD_T = 12; // 顶：最高那条网格线离图顶的距离
export const PAD_B = 18; // 底：给日期标签留的高度

// 一条线上切几段网格（4 段 = 5 条横线：0 / 1/4 / 1/2 / 3/4 / 满）
export const GRID_SEGS = 4;

export type Seg = { key: string; left: number; top: number; len: number; deg: number; color: string };
export type Dot = { key: string; x: number; y: number; color: string };
export type Mark = { key: string; x: number; text: string };
// zero=true 的就是最底下那条基线（值 0）。
// ⚠️ 它**两端不写数字**：左右两把尺子在那儿各挂一个「0」，看着像「0 和 0」没意义；
//    横轴两端改成写日期了（见下面 marks）。图上纵轴仍是从 0 起 —— 只是不标这个 0。
export type GridTick = { f: number; y: number; cal: number; carb: number; zero: boolean };

// 两条线的颜色。要换色只改这两行 —— 图例、虚线、圆点全都跟着变。
export const CAL_COLOR = '#F2994A'; // 总热量：橙
export const CARB_COLOR = '#2E96DB'; // 总碳水：淡蓝

export const hasData = (p?: TrendPoint): p is TrendPoint & { calories: number; carb: number } =>
  !!p && typeof p.calories === 'number' && typeof p.carb === 'number';

// 把坐标轴顶端抬到一个「整」的数（1800 → 2000，2631 → 3000，240 → 250）。
// 不这么做顶端会停在 1837.4 这种数上，轴上写出来的数字也跟着难看。
//
// ⚠️ 档位要够密：早先只留 1/2/2.5/5/10，结果 2631 会被抬到 5000 ——
//    半张图白空着，曲线全挤在下面半截（一眼看着像"爆表"）。
//    补上 1.5 / 3 / 4 之后最坏也只多浪费约 25%。
export function niceMax(v: number): number {
  if (!isFinite(v) || v <= 0) return 1;
  const base = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / base;
  const nice =
    n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 3 ? 3 : n <= 4 ? 4 : n <= 5 ? 5 : 10;
  return nice * base;
}

export function mdOf(iso: string): string {
  const p = iso.split('-');
  return `${Number(p[1])}/${Number(p[2])}`;
}

// 把一天在账本里的数汇总成两个点（总热量、总碳水）。n === 0 就只留空位。
function dayPoint(all: MealLogEntry[], iso: string): TrendPoint {
  let calories = 0;
  let carb = 0;
  let n = 0;
  for (const e of all) {
    if (e.date !== iso) continue;
    n += 1;
    calories += e.calories;
    carb += e.carb;
  }
  if (n === 0) return { date: iso }; // 留个空位，线从上面跨过去
  return { date: iso, calories: Math.round(calories), carb: Math.round(carb) };
}

// 把账本压成「从 fromIso 到 toIso（都含）」的每日点，**老的在前**。
// 「本周」「本月」这种**不是整 7 / 整 30 天**的区间就靠它 —— 比如这周才过了 3 天，
// 就老老实实画 3 天（用户原话："有几天画几天"，填 7 个空位把线拖到周末是骗图）。
export function buildTrendRange(
  all: MealLogEntry[],
  fromIso: string,
  toIso: string,
): TrendPoint[] {
  const n = diffDays(fromIso, toIso) + 1;
  if (n <= 0) return []; // 起止写反了 → 干脆不给点，别死循环
  const out: TrendPoint[] = [];
  for (let i = 0; i < n; i++) out.push(dayPoint(all, shiftISO(fromIso, i)));
  return out;
}

// 把账本压成「最近 days 天」的每日两个点（总热量、总碳水），**老的在前**。
export function buildTrendPoints(all: MealLogEntry[], days: number, todayIso: string): TrendPoint[] {
  return buildTrendRange(all, shiftISO(todayIso, -(days - 1)), todayIso);
}

// 「本周」的起点：**周一**。周日在手机日历里算上一周的末尾，所以 0（周日）要退 6 天。
export function startOfWeekIso(iso: string): string {
  const t = dateOf(iso);
  const dow = t.getDay(); // 0 = 周日 … 6 = 周六
  t.setDate(t.getDate() - (dow === 0 ? 6 : dow - 1));
  return toISO(t);
}

// 「本月」的起点：这个月 1 号。
export function startOfMonthIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, 1));
}

// 这个月最后一天（10/31 → 31）。下个月第 0 天就是上个月最后一天，别自己掰 28/30/31。
function endOfMonthIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return toISO(new Date(y, m, 0));
}

// 本周 7 天（周一 → 周日），**不管今天周几都排满 7 格**：
// 还没到的日子图上是空位（线画到今天为止就断在那儿），不是把横轴截短。
export function weekDates(todayIso: string): string[] {
  const s = startOfWeekIso(todayIso);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) out.push(shiftISO(s, i));
  return out;
}

// 本月全部日期（1 号 → 月末），同样排满整月。
export function monthDates(todayIso: string): string[] {
  const s = startOfMonthIso(todayIso);
  const e = endOfMonthIso(todayIso);
  return buildDateRange(s, e);
}

// 一串连续日期 [from … to]（含两端）。
export function buildDateRange(fromIso: string, toIso: string): string[] {
  const n = diffDays(fromIso, toIso) + 1;
  if (n <= 0) return []; // 起止写反 → 不给，别死循环
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(shiftISO(fromIso, i));
  return out;
}

// 星期几："2026-10-04" → "周日"。getDay() 里 0 是周日，中文序是 日一二三四五六。
// ⚠️ 返回**两个字的全名**（「周日」）而不是「周」+「日」：横轴标签里它是独立的一块，
//    拼的时候再往「日」后头接日期，读起来才是「周日 10/4」而不是「周周日 10/4」。
const DOW = ['日', '一', '二', '三', '四', '五', '六'];
export function dowOf(iso: string): string {
  return `周${DOW[dateOf(iso).getDay()]}`;
}

// 底部日期每隔几格写一个：天少就每格都写，天多了才隔 ——
// 不然「本月」31 个日期全糊上去会挤成一团看不出数。
export function labelEveryFor(n: number): number {
  if (n <= 10) return 1;
  if (n <= 18) return 2;
  if (n <= 40) return 5;
  return 8;
}

function dateOf(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 两个日期串相差几天（to − from）。跨月跨年交给 Date 算，别自己掰月份天数。
function diffDays(fromIso: string, toIso: string): number {
  const a = dateOf(fromIso).getTime();
  const b = dateOf(toIso).getTime();
  return Math.round((b - a) / 86400000);
}

// 本地日期加减（不引 lib/date，免得多一处依赖 —— 这里只要 YYYY-MM-DD 的加减）
function shiftISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(y, m - 1, d + days);
  return toISO(t);
}

// Date → "2026-10-05"
function toISO(t: Date): string {
  const mm = String(t.getMonth() + 1).padStart(2, '0');
  const dd = String(t.getDate()).padStart(2, '0');
  return `${t.getFullYear()}-${mm}-${dd}`;
}

// 把两点连成一段可旋转的细长条。
// ⚠️ left/top 写的是**线段中心**：这样转起来不管旋转原点在哪都绕中心转，不会甩出去。
function makeSeg(x1: number, y1: number, x2: number, y2: number, color: string): Seg {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  return {
    key: `${x1.toFixed(1)}-${y1.toFixed(1)}-${x2.toFixed(1)}`,
    left: (x1 + x2) / 2 - len / 2,
    top: (y1 + y2) / 2,
    len,
    deg: (Math.atan2(dy, dx) * 180) / Math.PI,
    color,
  };
}

// 横轴底下的日期怎么标（见 computeTrendGeom 里那段注释）
export type TrendXAxis = 'rolling' | 'month' | 'week';

export type TrendGeom = {
  plotW: number;
  plotH: number;
  calMax: number;
  carbMax: number;
  xAt: (i: number) => number;
  yAt: (v: number, max: number) => number;
  segsCal: Seg[];
  segsCarb: Seg[];
  dotsCal: Dot[];
  dotsCarb: Dot[];
  marks: Mark[];
  ticks: GridTick[];
};

// 给定「要画的点 + 这块图有多宽多高」，算出所有要摆的位置。
// 拿不到宽度（还没布局完）就返回 null —— 界面先不画线段，等 onLayout 量到了再画。
export function computeTrendGeom(input: {
  points: TrendPoint[];
  width: number;
  height: number;
  calTarget?: number;
  carbTarget?: number;
  labelEvery?: number;
  xAxis?: TrendXAxis;
}): TrendGeom | null {
  const { points, width, height, calTarget, carbTarget } = input;
  const labelEvery = Math.max(1, input.labelEvery ?? 1);
  if (width <= 0 || points.length === 0) return null;

  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = Math.max(0, height - PAD_T - PAD_B);
  const n = points.length;

  // 两把尺子的量程：把**当天最高的值**和**目标**一起比，谁高取谁 ——
  // 不然目标线会顶出图外（那条横线就看不见了）。×1.1 是给顶上留点空气。
  let maxCal = 0;
  let maxCarb = 0;
  for (const p of points) {
    if (hasData(p)) {
      maxCal = Math.max(maxCal, p.calories);
      maxCarb = Math.max(maxCarb, p.carb);
    }
  }
  const calMax = niceMax(Math.max(maxCal, calTarget ?? 0) * 1.1) || 1;
  const carbMax = niceMax(Math.max(maxCarb, carbTarget ?? 0) * 1.1) || 1;

  // x：第 i 天在整个宽度里的位置（**按完整日期数算**，不按"有记录的那几天"算，
  //    不然中间断了一天，后面的日子会整体往左挪，看着像日子自己跑了）
  const xAt = (i: number) => (n <= 1 ? PAD_L + plotW / 2 : PAD_L + (i / (n - 1)) * plotW);
  // y：值越大越靠上（0 在底，满量程在顶）
  const yAt = (v: number, max: number) => PAD_T + plotH * (1 - Math.min(Math.max(v / max, 0), 1));

  // ---- 曲线：相邻两天**都有记录**才连一段 ----
  const segsCal: Seg[] = [];
  const segsCarb: Seg[] = [];
  for (let i = 1; i < n; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!hasData(a) || !hasData(b)) continue; // 中间断了 → 从缺口上直接跨过去
    segsCal.push(makeSeg(xAt(i - 1), yAt(a.calories, calMax), xAt(i), yAt(b.calories, calMax), CAL_COLOR));
    segsCarb.push(makeSeg(xAt(i - 1), yAt(a.carb, carbMax), xAt(i), yAt(b.carb, carbMax), CARB_COLOR));
  }

  const dotsCal: Dot[] = [];
  const dotsCarb: Dot[] = [];
  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (!hasData(p)) continue;
    dotsCal.push({ key: `c${i}`, x: xAt(i), y: yAt(p.calories, calMax), color: CAL_COLOR });
    dotsCarb.push({ key: `b${i}`, x: xAt(i), y: yAt(p.carb, carbMax), color: CARB_COLOR });
  }

  // ---- 底部日期 ----
  // 三种横轴写法（xAxis）：
  //   rolling（过去 7 天 / 过去 30 天）：最左 = 起始日，最右 = 「今日」，中间按 labelEvery 隔几格写。
  //      ⚠️ 最右写「今日」不写日期 —— 写日期看不出"到现在为止"这层意思。
  //   month（本月）：最左 = 1 号，最右 = **月末几号**（整月都排出来了，末尾不是"今日"）。
  //   week（本周）：首尾只写日期（9/28 / 10/4），中间一格一个「周二 / 周三…」。
  //      ⚠️ 首尾**不**写「周一」「周日」（2026-10-02 艾可去掉的）：反正是本周卡，
  //      两头是周一周日显而易见，再写一遍是废话。
  const axis = input.xAxis ?? 'rolling';
  const marks: Mark[] = [];
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0;
    const isLast = i === n - 1;
    // 整周（week）是 7 格都要看得见「周几」，**不受 labelEvery 影响**；
    // 其余两种隔几格写一个，别把 30 个日期糊上去。
    if (axis !== 'week' && !isFirst && !isLast && i % labelEvery !== 0) continue;
    const d = mdOf(points[i].date);
    const text =
      axis === 'week'
        ? isFirst || isLast
          ? d // 首尾只写几号（周一周日那种话不说了）
          : dowOf(points[i].date)
        : isLast && axis !== 'month'
          ? '今日'
          : d;
    marks.push({ key: isLast ? 'mlast' : `m${i}`, x: xAt(i), text });
  }

  // ---- 网格：同一根横线上，左边标热量、右边标碳水（两把尺子共用这 5 条线）----
  const ticks: GridTick[] = [];
  for (let f = 0; f <= GRID_SEGS; f++) {
    const frac = f / GRID_SEGS;
    ticks.push({
      f,
      y: yAt(calMax * frac, calMax),
      cal: Math.round(calMax * frac),
      carb: Math.round(carbMax * frac),
      zero: f === 0,
    });
  }

  return { plotW, plotH, calMax, carbMax, xAt, yAt, segsCal, segsCarb, dotsCal, dotsCarb, marks, ticks };
}
