// 守卫测试：正则读 app/target.tsx 源码，断言「三餐分配」表格与「基本情况」表单的版式。
// 跑法（项目根目录）：node _target_test.js
// 不依赖任何框架，纯 Node 自带模块。
//
// 2026-09-30 版式定稿：表格每个格子数字**居中**、每格 numberOfLines=1（不换行），
// 抬头单位（千卡/克）用更小的字紧跟营养素名；表单 性别+年龄 一行、身高+体重 一行、
// 输入框数字居中。改这些的地方必跑本测试。
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'app', 'target.tsx');
const src = fs.readFileSync(file, 'utf8');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name);
  }
}

console.log('target.tsx 版式守卫：');

// ---- 三餐分配表格 ----
// 1. 抬头顺序：餐次 → 热量(千卡) → 占比 → 碳水(克) → 占比（数值列紧跟各自的占比列）。
//    单位「(千卡)/(克)」现在是嵌在 <Text> 里的小字，所以中间隔着一个标签，用 {0,60} 兜住。
check(
  '表格抬头顺序 餐次/热量(千卡)/占比/碳水(克)/占比',
  /餐次[\s\S]*?热量[\s\S]{0,60}?\(千卡\)[\s\S]*?占比[\s\S]*?碳水[\s\S]{0,60}?\(克\)[\s\S]*?占比/.test(src),
);
// 2. 抬头里不能出现冗余的「热量占比」「碳水占比」（占比紧跟数值列即可，不必重复营养素名）。
//    只查抬头那一行（mealTip 里「碳水占比」是解释性文字，允许存在）。
const headBlock = (src.match(/trHead\][\s\S]*?<\/View>/) || [''])[0];
check('抬头里没有「热量占比」', !headBlock.includes('热量占比'));
check('抬头里没有「碳水占比」', !headBlock.includes('碳水占比'));
// 3. 两处占比列都用了 tcPct 样式。
check('占比列用 tcPct 样式(≥4 处)', (src.match(/styles\.tcPct/g) || []).length >= 4);
// 4. 碳水数值列加了 tcNum2（和热量组拉开间距）。
check('碳水数值列用 tcNum2', src.includes('styles.tcNum2'));
// 5. 不写「约」。
check('全文无「约」字', !src.includes('约'));

// ---- 表格：数字居中 + 不换行 ----
// 6. 数值列 tcNum 居中。
check('tcNum 居中', /tcNum:\s*\{[\s\S]*?textAlign:\s*'center'/.test(src));
// 7. 占比列 tcPct 居中。
check('tcPct 居中', /tcPct:\s*\{[\s\S]*?textAlign:\s*'center'/.test(src));
// 8. 餐次列 tcName 居中。
check('tcName 居中', /tcName:\s*\{[\s\S]*?textAlign:\s*'center'/.test(src));
// 8b. 餐次列宽度必须够放两个汉字（≥46）：写 38 时手机大字号会把「早餐」截成「早…」。
check(
  'tcName 宽度≥46（防「早餐」被截成「早…」）',
  (() => {
    const m = src.match(/tcName:\s*\{[\s\S]*?width:\s*(\d+)/);
    return !!m && Number(m[1]) >= 46;
  })(),
);
// 9. 抬头单位用更小的字（thUnit 9 号），保证「热量(千卡)」整串横着不换行。
check('抬头单位 thUnit 9 号', /thUnit:\s*\{\s*fontSize:\s*9/.test(src));
// 10. 表格每个格子都有 numberOfLines={1}：抬头 5 + 数据行模板 5 = 10 处
//     （数据行是 [0,1,2].map 渲染的模板，源码里只出现一次）。
check('表格 numberOfLines≥10 处', (src.match(/numberOfLines=\{1\}/g) || []).length >= 10);

// ---- 基本情况表单 ----
// 11. 性别不再独占整行，而是用 fieldLabel 跟年龄同框。
check('性别用 fieldLabel（与年龄同行）', src.includes('fieldLabel}>性别'));
// 12. 两列一行 twoCol（性别+年龄、身高+体重 各一行）。
check('有两个 twoCol 行', (src.match(/styles\.twoCol/g) || []).length >= 2);
// 13. 四个 fieldLabel（性别/年龄/身高/体重）。
check('有四个 fieldLabel', (src.match(/styles\.fieldLabel/g) || []).length >= 4);
// 14. 性别/年龄/身高/体重 都进了 fieldLabel。
['性别', '年龄', '身高', '体重'].forEach((w) => {
  check('fieldLabel 含「' + w + '」', src.includes('fieldLabel}>' + w));
});
// 15. 输入框数字居中。
check('input 数字居中', /input:\s*\{[\s\S]*?textAlign:\s*'center'/.test(src));
// 16. 活动量/目标 仍是整行（目标那行用 labelNarrow 收窄标签）。
check('活动量仍是整行(label)', /styles\.label\}\s*numberOfLines=\{1\}>活动量/.test(src));
check('目标仍是整行(label)', /styles\.label,\s*styles\.labelNarrow\][\s\S]{0,40}?目标/.test(src));
// 16b. 标签列宽必须够放「活动量」三个汉字（≥48），否则大字号下会折成「活动」/「量」两行。
check(
  'LABEL_W ≥ 48（防「活动量」折行）',
  (() => {
    const m = src.match(/const LABEL_W = (\d+)/);
    return !!m && Number(m[1]) >= 48;
  })(),
);
check('label 宽度引用 LABEL_W', /label:\s*\{[\s\S]*?width:\s*LABEL_W/.test(src));
check('hint 缩进跟着 LABEL_W', src.includes('paddingLeft: LABEL_W + space.sm'));
// 16c. 目标行三个选项不折行（chipsNoWrap）。
check('目标行 chipsNoWrap', src.includes('styles.chipsNoWrap'));
check(
  'chipsNoWrap 是 nowrap',
  /chipsNoWrap:\s*\{[\s\S]*?flexWrap:\s*'nowrap'/.test(src),
);

// ---- 安全下限 / 配色 ----
// 17. 表格不出现橘黄高亮（早餐碳水不再单独标色）。
check('无橘黄 #EA580C', !src.includes('#EA580C'));
check('无 mealNumHi 高亮', !src.includes('mealNumHi'));
// 18. 整页底部留白防被底栏遮挡。
check('content.paddingBottom: 48', /paddingBottom:\s*48/.test(src));
// 19. 三餐标签仍是竖排（早/中/晚 一行一餐）。
check('MEAL_LABELS 仍为 早/中/晚', src.includes("['早餐', '中餐', '晚餐']"));

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
