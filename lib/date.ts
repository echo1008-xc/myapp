// 所有跟「日期」有关的计算都集中在这里。
// 页面只负责把结果显示出来，不要在页面里自己算天数 —— 算错一次，到处都错。
//
// 为什么不用现成的日期库：这个 App 只需要「今天是哪天、差几天、怎么显示」三件事，
// 引入一个几十 KB 的库不值得。等真的需要时区、农历这些东西再换。

// 把 Date 变成 "2026-09-20"。
// padStart(2, '0') 的意思是：位数不够就在前面补 0，把 9 补成 09。
export function toISODate(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// 今天，例如 "2026-09-14"。
export function today(): string {
  return toISODate(new Date());
}

// 从「今天」往后推 days 天。
// days = 0 就是今天，1 是明天，-1 是昨天。
// 用 0 而不是写死"今天"，好处是切换日期时只会影响到一处。
export function shiftDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// 从一个**日期串**往前 / 往后推几天：shiftISO('2026-09-26', -1) → '2026-09-25'。
// 跟上面的 shiftDays 不是一回事 —— 那个永远从「今天」出发，只用来算截止日期；
// 这个是从任意一天出发，数「连续记录了几天」要用它往回一天一天挪。
// 传进来的不是合法日期就原样退回，不抛错（宁可数字算得保守，也不能让页面崩）。
export function shiftISO(iso: string, days: number): string {
  if (!isValidDate(iso)) {
    return iso;
  }
  const [year, month, day] = iso.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

// 判断一个字符串是不是合法的 "2026-09-20"。
// 先看长相（四位-两位-两位），再看它是不是真实存在的日子 ——
// 这一步能挡住 "2026-02-31" 和 "2026-13-01" 这种看着像其实不存在的东西。
export function isValidDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const [year, month, day] = text.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// 距离今天还有几天。负数表示已经过去了。
// 只看年月日，不看具体几点几分，所以「今天」永远是 0。
export function daysFromToday(iso: string): number | null {
  if (!isValidDate(iso)) {
    return null;
  }
  const [year, month, day] = iso.split('-').map(Number);
  const target = new Date(year, month - 1, day);
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // 除以一天的毫秒数。用 round 而不是 floor，是为了绕过夏令时造成的 ±1 小时误差。
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

// 把 "2026-09-20" 显示成「9月20日」；不是今年的就带上年份。
export function formatDate(iso: string): string {
  if (!isValidDate(iso)) {
    return iso;
  }
  const [year, month, day] = iso.split('-').map(Number);
  return year === new Date().getFullYear()
    ? `${month}月${day}日`
    : `${year}年${month}月${day}日`;
}

// 截止日期的「紧张程度」。颜色由显示组件根据这个值去主题里取，这里绝不写死颜色。
export type DueTone = 'overdue' | 'today' | 'soon' | 'later';

export type DueInfo = {
  tone: DueTone;
  label: string;
};

// 把截止日期翻译成人话：逾期 2 天 / 今天到期 / 还有 3 天 / 9月20日。
// 传 null 或非法值都返回 null，调用方据此决定"不显示徽章"。
export function describeDue(iso: string | null): DueInfo | null {
  if (!iso) {
    return null;
  }
  const diff = daysFromToday(iso);
  if (diff === null) {
    return null;
  }
  if (diff < 0) {
    return { tone: 'overdue', label: `逾期 ${-diff} 天` };
  }
  if (diff === 0) {
    return { tone: 'today', label: '今天到期' };
  }
  if (diff === 1) {
    return { tone: 'soon', label: '明天到期' };
  }
  if (diff <= 7) {
    return { tone: 'soon', label: `还有 ${diff} 天` };
  }
  return { tone: 'later', label: formatDate(iso) };
}
