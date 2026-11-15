#!/usr/bin/env node
/* 题目 bootstrap：算「换一批同质量的题，总分能晃多少」。
 *
 * 为什么要有它：判分键里原来写「半宽约 ±8 分」，那是我拍的，不是算的。实测 20 个计分点
 * 的真实半宽是 14–19 分——**接近两倍**。这一条不是措辞问题：半宽 15 意味着 75 分的判定
 * 线与 60 分的线在同一个人的一次施测里分不开，那是量具的硬限制，必须报出来。
 *
 * 用法：
 *   node closed-book-bootstrap.mjs                    # 按标准卷的 20 个计分点跑一张表
 *   node closed-book-bootstrap.mjs 14 4 2             # 指定满分数 / 半分数 / 零分数
 *
 * 判据：把 score 乘 100 就是总分；半宽是 95% 区间的一半。
 */
import process from 'node:process';

/** 20 个计分点（标准卷的密度），每点分值 5。 */
export const STANDARD_POINTS = 20;

/** 给定每个计分点的得分（0／0.5／1），算总分的 95% 区间。 */
export function bootstrapTotal(points, rounds = 20000, seed = 42) {
  const n = points.length;
  if (n === 0) return { 总分行: 0, 下界: 0, 上界: 0, 半宽: 0 };
  const per = 100 / n;
  let state = seed;
  const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  const totals = [];
  let observed = 0;
  for (const value of points) observed += value * per;
  for (let i = 0; i < rounds; i += 1) {
    let sum = 0;
    for (let j = 0; j < n; j += 1) sum += points[Math.floor(rand() * n)] * per;
    totals.push(sum);
  }
  totals.sort((a, b) => a - b);
  const at = (q) => totals[Math.min(totals.length - 1, Math.floor(totals.length * q))];
  const lower = at(0.025);
  const upper = at(0.975);
  const round = (x) => Number(x.toFixed(1));
  return { 总分行: round(observed), 下界: round(lower), 上界: round(upper), 半宽: round((upper - lower) / 2) };
}

/** 造一组「满分 m 个、半分 h 个、零分 z 个」的计分点。 */
export function pointsOf({ full = 0, half = 0, zero = 0 }) {
  return [
    ...Array(full).fill(1),
    ...Array(half).fill(0.5),
    ...Array(zero).fill(0),
  ];
}

/** 标准卷的几种典型答卷，判分键里那张表就是它跑出来的。 */
export const SCENARIOS = [
  { 名字: '几乎全对（18 满 2 半）', spec: { full: 18, half: 2 } },
  { 名字: '强（14 满 4 半 2 零）', spec: { full: 14, half: 4, zero: 2 } },
  { 名字: '中（10 满 5 半 5 零）', spec: { full: 10, half: 5, zero: 5 } },
  { 名字: '弱（6 满 4 半 10 零）', spec: { full: 6, half: 4, zero: 10 } },
  { 名字: '很差（2 满 2 半 16 零）', spec: { full: 2, half: 2, zero: 16 } },
];

/** 计分点增加到 n 个时半宽怎么变（用 0.6 的通过率造点）。 */
export function halfWidthAt(n, passRate = 0.6, rounds = 20000, seed = 7) {
  const points = Array.from({ length: n }, (_, i) => (i / n < passRate ? 1 : 0));
  return bootstrapTotal(points, rounds, seed).半宽;
}

if (process.argv[1] && process.argv[1].endsWith('closed-book-bootstrap.mjs')) {
  const args = process.argv.slice(2).map(Number).filter((x) => Number.isFinite(x));
  if (args.length === 3) {
    const [full, half, zero] = args;
    const result = bootstrapTotal(pointsOf({ full, half, zero }));
    console.log(`${full} 满 / ${half} 半 / ${zero} 零 → 总分 ${result.总分行}，95% 区间 [${result.下界}, ${result.上界}]，半宽 ${result.半宽}`);
  } else {
    console.log(`题目 bootstrap（${STANDARD_POINTS} 个计分点，每点 ${(100 / STANDARD_POINTS).toFixed(1)} 分）\n`);
    console.log(['答卷', '总分', '95% 下界', '95% 上界', '半宽'].join('\t'));
    for (const { 名字, spec } of SCENARIOS) {
      const r = bootstrapTotal(pointsOf(spec));
      console.log([名字, r.总分行, r.下界, r.上界, r.半宽].join('\t'));
    }
    console.log('\n计分点增加，半宽怎么变（通过率 0.6）：');
    for (const n of [10, 20, 40, 80, 160]) console.log(`  ${String(n).padStart(3)} 个点 → 半宽 ${halfWidthAt(n)}`);
    console.log('\n要把半宽压到 5 分，计分点需要约 ' +
      `${Math.round(STANDARD_POINTS * (bootstrapTotal(pointsOf({ full: 12, half: 4, zero: 4 })).半宽 / 5) ** 2)} 个——30 分钟的卷子做不到。`);
  }
}
