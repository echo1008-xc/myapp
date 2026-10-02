import type { CategoryKey } from '../lib/categories';

// 一条任务的形状。全 App 只有这一处定义，改这里就等于改全部。
export type Task = {
  id: string;
  title: string;
  note: string;
  done: boolean;
  createdAt: string;
  // 截止日期，格式固定是 2026-09-20 这种（年月日，中间一个短横线）。
  // 不设截止日期就是 null —— 用 null 而不是空字符串，是为了让「没设」和「设了个空」区分得开。
  dueDate: string | null;
  // 这条任务重不重要。只有两种：true（亮星星）/ false（不亮）。
  //
  // 为什么不做「1~5 颗星」的分级：分级看着高级，但真用起来你会发现
  // 每次都要停下来想"这算 3 星还是 4 星"，想几天就烦了。
  // 只分"重要 / 不重要"，判断成本为零，才是能一直用下去的做法。
  important: boolean;
  // 分类标签：固定几个值（工作 / 生活 / 学习 / 紧急），列表里按颜色一眼区分。
  // 'none' 表示没分类（新建任务默认）。
  category: CategoryKey;
};
