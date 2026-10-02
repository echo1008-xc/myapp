// 断言：把「本周 / 本月」那几个纯函数当真代码跑一遍。
const t = require('./_gtest/meal/trend.js');

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}
function eq(name, a, b) { ok(name + ' = ' + b, a === b, 'got ' + a); }

// 一条账本条目长得像啥都行，这里只吃 date / calories / carb
const entries = [
  { date: '2026-09-28', calories: 1800, carb: 180 },
  { date: '2026-09-29', calories: 2100, carb: 200 },
  { date: '2026-09-30', calories: 1500, carb: 140 },
  { date: '2026-10-01', calories: 2200, carb: 230 },
  { date: '2026-10-02', calories: 1900, carb: 195 },
  { date: '2026-10-03', calories: 2400, carb: 250 },
];

console.log('--- startOfWeekIso（周一为一周起点）---');
// 2026-10-02 是周五 → 本周一 = 2026-09-28
eq('周五 → 本周一', t.startOfWeekIso('2026-10-02'), '2026-09-28');
// 2026-10-05 是周一 → 就是当天
eq('周一 → 当天', t.startOfWeekIso('2026-10-05'), '2026-10-05');
// 2026-10-04 是周日 → 退 6 天到上一个周一 09-28
eq('周日 → 上一个周一', t.startOfWeekIso('2026-10-04'), '2026-09-28');
// 2026-10-03 是周六 → 退 5 天到 09-28
eq('周六 → 本周一', t.startOfWeekIso('2026-10-03'), '2026-09-28');
// 跨月：2026-09-01 是周二 → 08-31（周一）
eq('跨月 9/1 → 8/31', t.startOfWeekIso('2026-09-01'), '2026-08-31');
// 跨年：2027-01-01 是周五 → 2026-12-28
eq('跨年 1/1 → 12/28', t.startOfWeekIso('2027-01-01'), '2026-12-28');

console.log('--- startOfMonthIso ---');
eq('10/02 → 10/01', t.startOfMonthIso('2026-10-02'), '2026-10-01');
eq('跨年 1/15 → 1/01', t.startOfMonthIso('2027-01-15'), '2027-01-01');
eq('整月 3/31 → 3/01', t.startOfMonthIso('2026-03-31'), '2026-03-01');

console.log('--- buildTrendRange：有几天画几天 ---');
// 本周一 09-28 ~ 周五 10-02，账本里这 5 天全有记录 → 5 个点且都不空
const wk = t.buildTrendRange(entries, '2026-09-28', '2026-10-02');
eq('本周点数', wk.length, 5);
eq('首日', wk[0].date, '2026-09-28');
eq('末日', wk[wk.length - 1].date, '2026-10-02');
ok('本周每天都有值（没补空格）', wk.every((p) => p.calories > 0));
eq('周五热量合计', wk[4].calories, 1900);

// 只过了 3 天（周一~周三有记录，周四周五没有）→ 仍然 5 天区间，但后两天是空位、
// 前面的线跨过缺口连过去，绝不把端点补成 0
const wk3 = t.buildTrendRange(entries, '2026-09-28', '2026-09-30');
eq('本周前 3 天点数', wk3.length, 3);
eq('第 3 天热量', wk3[2].calories, 1500);

console.log('--- 起止写反 / 起止相同 ---');
eq('起止写反 → 空数组', t.buildTrendRange(entries, '2026-10-02', '2026-09-28').length, 0);
eq('同一天 → 1 个点', t.buildTrendRange(entries, '2026-10-02', '2026-10-02').length, 1);
eq('同一天热量', t.buildTrendRange(entries, '2026-10-02', '2026-10-02')[0].calories, 1900);

console.log('--- 跟旧的 buildTrendPoints 对得上 ---');
const p7 = t.buildTrendPoints(entries, 7, '2026-10-02');
eq('过去 7 天点数', p7.length, 7);
eq('过去 7 天首日', p7[0].date, '2026-09-26');
const p30 = t.buildTrendPoints(entries, 30, '2026-10-02');
eq('过去 30 天点数', p30.length, 30);
eq('过去 30 天末日', p30[29].date, '2026-10-02');
ok('30 天里除 09-28~10-02 外全是空位', p30.slice(0, 2).every((p) => p.calories === undefined));

console.log('--- labelEveryFor：天少每格都写，天多才隔 ---');
eq('2 天 → 1', t.labelEveryFor(2), 1);
eq('7 天 → 1', t.labelEveryFor(7), 1);
eq('10 天 → 1', t.labelEveryFor(10), 1);
eq('15 天 → 2', t.labelEveryFor(15), 2);
eq('30 天 → 5', t.labelEveryFor(30), 5);
eq('31 天 → 5', t.labelEveryFor(31), 5);

console.log('--- 本月（月初只有 3 天）也能算 ---');
const mo = t.buildTrendRange(entries, t.startOfMonthIso('2026-10-05'), '2026-10-05');
eq('10/5 的本月已过天数', mo.length, 5);
eq('本月首日', mo[0].date, '2026-10-01');
// 账本里 10/03 之后就没记录了 → 10/04、10/05 是空位（不是 0），10/03 才是 2400
// mo = [10/01, 10/02, 10/03, 10/04, 10/05]，账本记到 10/03 为止
eq('本月：10/01 热量', mo[0].calories, 2200); // 示例账本里 10/01 记得 2200
eq('本月：10/02 热量', mo[1].calories, 1900);
eq('本月：10/03 是最后一条有记录的', mo[2].date, '2026-10-03');
eq('本月：10/03 热量', mo[2].calories, 2400);
eq('本月：10/05 没记录 → 空位', mo[4].calories, undefined);
ok('本月：空位那格仍然占位（点数不变）', mo.length === 5);

console.log('--- 坐标：切到「本周」后点的数量变了，x 位置仍然按完整日期数算 ---');
const g = t.computeTrendGeom({ points: wk, width: 342, height: 170, calTarget: 2250, carbTarget: 250 });
ok('本周 5 个点也有图', !!g);
eq('5 点 → 4 段线', g.segsCal.length, 4);
ok('首点在最左', Math.abs(g.xAt(0) - 34) < 0.01);
ok('末点在最右', Math.abs(g.xAt(4) - (34 + g.plotW)) < 0.01);
eq('底部 5 个日期标签', g.marks.length, 5);
eq('末标签写「今日」', g.marks[4].text, '今日');

console.log('--- weekDates：整周 7 格排满，今天之后也在列 ---');
// 今天 2026-10-02（周五）→ 周一 09-28 … 周日 10-04
const wd = t.weekDates('2026-10-02');
eq('本周 7 天', wd.length, 7);
eq('第 1 格 = 周一', wd[0], '2026-09-28');
eq('第 7 格 = 周日', wd[6], '2026-10-04');
eq('第 5 格 = 今天(周五)', wd[4], '2026-10-02');
// 造一组「只记到今天」的账本：周六周日还没发生 → 必须留空位，不能补 0
const wkEntries = [
  { date: '2026-09-28', calories: 1800, carb: 180 },
  { date: '2026-09-29', calories: 2100, carb: 200 },
  { date: '2026-09-30', calories: 1500, carb: 140 },
  { date: '2026-10-01', calories: 2200, carb: 230 },
  { date: '2026-10-02', calories: 1900, carb: 195 },
];
const wkFut = t.buildTrendRange(wkEntries, wd[0], wd[6]);
eq('整周仍是 7 个点', wkFut.length, 7);
eq('周六还没到 → 空位', wkFut[5].calories, undefined);
eq('周日还没到 → 空位', wkFut[6].calories, undefined);
ok('周六周日的坑位还在（横轴长度不变）', wkFut[6].date === '2026-10-04');
ok('今天这格有值', wkFut[4].calories === 1900);
// 今天周日：整周也是 7 格，最后一格是今天
const wdSun = t.weekDates('2026-10-04');
eq('周日的第 7 格 = 今天', wdSun[6], '2026-10-04');
eq('周日的第 1 格是上一个周一', wdSun[0], '2026-09-28');
// 今天周一：整周 7 格全部是「今天及以前」，没有未来格
const wdMon = t.weekDates('2026-10-05');
eq('周一的第 1 格 = 今天', wdMon[0], '2026-10-05');
eq('周一的第 7 格是下周日', wdMon[6], '2026-10-11');

console.log('--- dowOf ---');
eq('2026-10-04 → 周日', t.dowOf('2026-10-04'), '周日');
eq('2026-09-28 → 周一', t.dowOf('2026-09-28'), '周一');
eq('2026-10-02 → 周五', t.dowOf('2026-10-02'), '周五');

console.log('--- monthDates：整月排满 ---');
const md = t.monthDates('2026-10-02');
eq('10 月天数', md.length, 31);
eq('首格 = 1 号', md[0], '2026-10-01');
eq('末格 = 31 号', md[30], '2026-10-31');
const md2 = t.monthDates('2026-02-10'); // 2026 不是闰年 → 28 天
eq('2 月天数', md2.length, 28);
eq('2 月末 = 28 号', md2[27], '2026-02-28');
eq('1 月天数', t.monthDates('2027-01-15').length, 31);

console.log('--- 横轴标签（xAxis）---');
const mWeek = t.computeTrendGeom({
  points: wkFut,
  width: 342,
  height: 170,
  labelEvery: 5, // ⚠️ week 模式不理这个，7 格全写
  xAxis: 'week',
});
ok('本周 7 格全有标签', mWeek && mWeek.marks.length === 7, mWeek ? 'got ' + mWeek.marks.length : 'null');
eq('最左只写日期（不带「周一」）', mWeek.marks[0].text, '9/28');
eq('第 2 格 = 二', mWeek.marks[1].text, '周二');
eq('第 5 格（今天）= 五', mWeek.marks[4].text, '周五');
eq('最右只写日期（不带「周日」）', mWeek.marks[6].text, '10/4');

const mMonth = t.computeTrendGeom({
  points: t.buildTrendRange(entries, t.monthDates('2026-10-02')[0], t.monthDates('2026-10-02')[30]),
  width: 342,
  height: 180,
  labelEvery: 5,
  xAxis: 'month',
});
eq('本月最左 = 10/1', mMonth.marks[0].text, '10/1');
eq('本月最右 = 10/31（不再写「今日」）', mMonth.marks[mMonth.marks.length - 1].text, '10/31');
ok('本月中间隔 5 天写一个', mMonth.marks.length > 4 && mMonth.marks.length < 31,
  'got ' + mMonth.marks.length);

const mRoll = t.computeTrendGeom({ points: p7, width: 342, height: 170, labelEvery: 1, xAxis: 'rolling' });
eq('rolling 最右仍是「今日」', mRoll.marks[mRoll.marks.length - 1].text, '今日');

console.log('--- 未来空位不该被连上线（今天周五、周六周日空着 → 只有 4 段线）---');
eq('整周 7 点 → 4 段（9/28~10/02 连着，之后断开）', mWeek.segsCal.length, 4);
ok('未来那两格确实没有圆点', mWeek.dotsCal.length === 5);

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
