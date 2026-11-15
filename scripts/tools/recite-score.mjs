#!/usr/bin/env node
/* 背默卡的计分：S1 命题召回 + S2 结构档 + 迁移探针，并给出 S1 的题目 bootstrap 区间。
 *
 * 为什么单独一个工具：卷子的分是「一题一题加出来的」，背默卡的分是「要点表里命中了几条」——
 * 后者的误差来源完全不同（误差来自**要点表本身抽得好不好**，不是学生答得对不对）。
 * 所以区间也是按要点重抽样算的，不是按题。
 *
 * 用法：
 *   node recite-score.mjs <要点表.json> <作答.json>
 *
 * 要点表：{ "节点": "...", "要点": [{"id":"P1","类型":"骨架|因果|术语","要点":"..."}] }
 * 作答：  { "命中": ["P1"], "部分": ["P3"], "结构档": 2, "迁移探针": 1 }
 */
import fs from 'node:fs';

/** S1 / S2 / 迁移探针，按判分键「背默卡的计分」那一节的闸门判定。 */
export function scoreRecite(rubric, answer) {
  const total = rubric.要点.length;
  if (total === 0) return null;
  const hit = new Set(answer.命中 || []);
  const half = new Set(answer.部分 || []);
  const s1 = (hit.size + 0.5 * half.size) / total;
  const s2 = answer.结构档;
  const probe = answer.迁移探针;

  let verdict;
  if (s1 >= 0.8 && s2 >= 2 && probe === 1) verdict = '通过';
  else if (s1 >= 0.8) verdict = '部分通过';
  else verdict = '不通过';

  return {
    命题召回S1: Number(s1.toFixed(3)),
    结构档S2: s2,
    迁移探针: probe,
    判定: verdict,
    缺口: rubric.要点.filter((p) => !hit.has(p.id)).map((p) => `${p.id}（${p.类型}）${p.要点}`),
  };
}

/** 要点 bootstrap：把要点当抽样单位，重估 S1 的 95% 区间。
 *
 * 这是 n=1 时唯一严格成立的信度估计——要点确实有多个，换一批同质量的要点，S1 会晃多少。
 * 注意它**不回答**「这个人稳定不稳定」，只回答「这张要点表抽得够不够」。
 */
export function bootstrapS1(rubric, answer, rounds = 20000, seed = 42) {
  const values = rubric.要点.map((point) => {
    if ((answer.命中 || []).includes(point.id)) return 1;
    if ((answer.部分 || []).includes(point.id)) return 0.5;
    return 0;
  });
  const n = values.length;
  if (n === 0) return null;
  let state = seed;
  const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const means = [];
  for (let i = 0; i < rounds; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += values[Math.floor(rand() * n)];
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const at = (q) => means[Math.min(means.length - 1, Math.floor(means.length * q))];
  return {
    要点数: n,
    下界: Number(at(0.025).toFixed(3)),
    上界: Number(at(0.975).toFixed(3)),
    半宽: Number(((at(0.975) - at(0.025)) / 2).toFixed(3)),
  };
}

/** 闸门的边界条件：S1 的 0.8 这条线，在要点表只有 n 条时能被分辨到多细。 */
export function s1Resolution(total) {
  // 一条要点的权重是 1/total；半条是 0.5/total。所以相邻两档最小差 = 0.5/total。
  return Number((0.5 / total).toFixed(3));
}

if (process.argv[1] && process.argv[1].endsWith('recite-score.mjs')) {
  const [rubricPath, answerPath] = process.argv.slice(2);
  if (!rubricPath || !answerPath) {
    console.error('用法：node recite-score.mjs <要点表.json> <作答.json>');
    process.exit(2);
  }
  const rubric = JSON.parse(fs.readFileSync(rubricPath, 'utf8'));
  const answer = JSON.parse(fs.readFileSync(answerPath, 'utf8'));
  const result = scoreRecite(rubric, answer);
  console.log(JSON.stringify({
    ...result,
    S1区间: bootstrapS1(rubric, answer),
    S1最小可辨差: s1Resolution(rubric.要点.length),
  }, null, 2));
}
