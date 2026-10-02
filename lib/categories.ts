// 任务的分类标签。固定几个值（而不是让用户自由打字），
// 好处：颜色统一、不会打错字，列表里一眼就能按颜色区分。
export type CategoryKey = 'none' | 'work' | 'life' | 'study' | 'urgent';

export type CategoryDef = {
  key: CategoryKey;
  label: string;
  color: string; // 主色：圆点、文字
  soft: string; // 浅底色：胶囊背景、选中态
};

export const CATEGORIES: CategoryDef[] = [
  { key: 'none', label: '未分类', color: '#8A99AC', soft: '#EEF2F6' },
  { key: 'work', label: '工作', color: '#1FA2FF', soft: '#E5F6FF' },
  { key: 'life', label: '生活', color: '#22C58B', soft: '#E2F8F0' },
  { key: 'study', label: '学习', color: '#9B6CFF', soft: '#F1EAFF' },
  { key: 'urgent', label: '紧急', color: '#FF5A5F', soft: '#FFECEC' },
];

export const CATEGORY_MAP: Record<CategoryKey, CategoryDef> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.key] = c;
    return acc;
  },
  {} as Record<CategoryKey, CategoryDef>,
);

const VALID_KEYS: string[] = CATEGORIES.map((c) => c.key);

// 老数据 / 云端缺字段 / 存进奇怪的值，统一退回「未分类」，而不是显示一团 undefined。
export function getCategory(key: string | null | undefined): CategoryDef {
  if (key && VALID_KEYS.includes(key)) {
    return CATEGORY_MAP[key as CategoryKey];
  }
  return CATEGORY_MAP.none;
}
