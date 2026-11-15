#!/usr/bin/env node
/* 闸门可判别性：一条判定线在给定的要点数/计分点下，到底能不能把两个人分开。
 *
 * 为什么要有它：判分键里写着「S1 ≥ 0.8 才算通过」。这句话看起来是个判决，其实是**一个点**。
 * 而每个 S1 都有自己的 95% 区间——两个 S1 的**区间重叠**时，这条闸门就分不出高下。
 *
 * 2026-11-15 实测（18 条要点）：
 *   S1 = 0.778（判「不通过」）区间 [0.556, 0.944]
 *   S1 = 0.889（判「通过」）  区间 [0.722, 1.000]
 *   两个区间大面积重叠 —— 这两份答卷的不同结论，**靠的是那 2 条要点的差，而不是证据**。
 *
 * 这个工具回答一个问题：**给定要点数与闸门线，「过线」与「不过线」的两侧最近点，
 * 它们的区间重不重叠？** 重叠就是不可判。
 *
 * 用法：
 *   node gate-resolvability.mjs <总点数> [闸门线]
 *   node gate-resolvability.mjs 18 0.8
 *   node gate-resolvability.mjs --table          # 常见点数下逐个算
 */
import { bootstrapS1 } from './recite-score.mjs';

/** 造 n 条要点、命中 k 条的作答。 */
function answerWith(n, k) {
  const 要点 = Array.from({ length: n }, (_, i) => ({ id: `P${i + 1}`, 类型: '骨架', 要点: 'x' }));
  return { 要点, 命中: 要点.slice(0, k).map((p) => p.id) };
}

/** 在 n 条要点、闸门线 gate 下，最接近闸门的两侧各是哪一档，区间重叠多少。 */
export function gateResolvability(n, gate) {
  // 枚举所有命中数，找最靠近闸门线的「过线」与「不过线」两档
  const rows = [];
  for (let k = 0; k <= n; k += 1) {
    const s1 = k / n;
    // 第二个参数是**作答**，不是空对象——传 `{}` 会让每个点都算成「没有命中」，区间全是 [0,0]，
    // 整张表就成了「全都可判」的假象。第一版就是这么错的。
    const answer = answerWith(n, k);
    const band = bootstrapS1(answer, answer, 4000);
    rows.push({ 命中: k, S1: Number(s1.toFixed(3)), 下界: band.下界, 上界: band.上界, 过线: s1 >= gate });
  }
  const pass = rows.filter((r) => r.过线).sort((a, b) => a.S1 - b.S1)[0];
  const fail = rows.filter((r) => !r.过线).sort((a, b) => b.S1 - a.S1)[0];
  if (!pass || !fail) return null;
  const overlapLo = Math.max(pass.下界, fail.下界);
  const overlapHi = Math.min(pass.上界, fail.上界);
  const overlap = Math.max(0, overlapHi - overlapLo);
  return {
    点数: n,
    闸门: gate,
    最接近的不过线档: fail,
    最接近的过线档: pass,
    区间重叠宽度: Number(overlap.toFixed(3)),
    可判: overlap === 0,
  };
}

/** **这条闸门永远不可判，不是因为要点不够多。**
 *
 * 上面那张表说明的是一件比「要点少」更根本的事：**相邻两档本身就只差 1/n**。
 * 只要闸门线不落在某个可取的格点上，最接近它的「过线」与「不过线」两档就差了 1/n——
 * 而它们的区间宽度是 O(1/√n)。**1/n 永远比 1/√n 衰减得快**，所以重叠会缩小，
 * 但**永远不会归零**。
 *
 * 实测（闸门 0.8）：
 *   18 条 → 重叠 0.277
 *   60 条 → 0.183
 *   400 条 → 0.071
 *
 * 结论：**「S1 ≥ 0.8」这句话在任何要点数下都不是一个可判的判决**，除非把闸门线挪到
 * 一个恰好能被 n 整除的格点上（如 15 条时的 12/15 = 0.8）。
 *
 * 所以正确的读法不是「再攒要点」，而是：**报 S1 与它的区间，让读的人看见这个宽度**；
 * 闸门只用于「差得远」与「差得近」的粗分，不用于贴线判决。
 */

/** 要点数从 min 到 max 逐档算，给出「要点至少几条才能让闸门可判」。 */
export function minimumPointsFor(gate, min = 8, max = 60) {
  for (let n = min; n <= max; n += 1) {
    const r = gateResolvability(n, gate);
    if (r && r.可判) return n;
  }
  return null;
}

if (process.argv[1] && process.argv[1].endsWith('gate-resolvability.mjs')) {
  if (process.argv.includes('--table')) {
    console.log('要点数\t不过线档\t过线档\t区间重叠\t可判');
    for (const n of [10, 15, 18, 20, 30, 40, 60]) {
      const r = gateResolvability(n, 0.8);
      if (!r) continue;
      console.log(`${n}\t${r.最接近的不过线档.S1}（[${r.最接近的不过线档.下界},${r.最接近的不过线档.上界}]）` +
        `\t${r.最接近的过线档.S1}（[${r.最接近的过线档.下界},${r.最接近的过线档.上界}]）` +
        `\t${r.区间重叠宽度}\t${r.可判 ? '是' : '否'}`);
    }
    const need = minimumPointsFor(0.8);
    console.log(`\n闸门 0.8 在 8–60 条要点里，要点达到 ${need ?? '（60 条以内仍然不可判）'} 条才可判。`);
  } else {
    const n = Number(process.argv[2]);
    const gate = process.argv[3] === undefined ? 0.8 : Number(process.argv[3]);
    if (!Number.isFinite(n) || n <= 0) { console.error('用法：node gate-resolvability.mjs <总点数> [闸门线]'); process.exit(2); }
    const r = gateResolvability(n, gate);
    if (!r) { console.log('闸门线落在所有可能得分之外，没有可比的两档。'); process.exit(0); }
    console.log(JSON.stringify(r, null, 2));
  }
}
