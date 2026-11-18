// geo-desk · 指标：提及率、推荐位次、SOV、引用率、准确率，全部带样本量与区间。
// 口径写在报告里，代码里只做计算——两边对不上就是 bug。

/**
 * Wilson 区间：小样本下比正态近似靠谱，n 很小时会诚实地给出很宽的区间。
 * @param {number} p - 比例（0–1）。
 * @param {number} n - 样本量。
 * @param {number} z - 置信水平，默认 95%。
 * @returns {{ low: number, high: number, halfWidth: number }} 都是百分点（0–100）。
 */
export function wilson(p, n, z = 1.96) {
  if (!n || n <= 0) return { low: 0, high: 100, halfWidth: 50 }
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const spread = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  const low = Math.max(0, centre - spread)
  const high = Math.min(1, centre + spread)
  return {
    low: Math.round(low * 1000) / 10,
    high: Math.round(high * 1000) / 10,
    halfWidth: Math.round(((high - low) / 2) * 1000) / 10,
  }
}

const pct = value => Math.round(value * 1000) / 10

/**
 * 汇总一批答案。
 * @param {object[]} answers - answers.jsonl 里的记录。
 * @param {object[]} prompts - 问题库。
 * @param {object} client - 客户档案。
 * @returns {object} 报告和面板共用的指标对象。
 */
export function summarize(answers, prompts, client) {
  const byId = new Map(prompts.map(prompt => [prompt.id, prompt]))
  const valid = answers.filter(row => row && row.ok !== false && row.answer)
  const n = valid.length
  const mentions = valid.filter(row => row.brand?.mentioned && !row.brand?.negated)
  const ranked = valid.filter(row => typeof row.brand?.rank === 'number')
  const top3 = ranked.filter(row => row.brand.rank <= 3)
  const top1 = ranked.filter(row => row.brand.rank === 1)
  const citing = valid.filter(row => (row.cites?.length ?? 0) > 0)
  const owned = valid.filter(row => (row.citedBrandSources ?? 0) > 0)
  const errored = valid.filter(row => (row.issues?.length ?? 0) > 0)

  // 声量份额：本品牌出现次数 /（本品牌 + 所有同行出现次数），按答案累计
  let brandHits = 0
  let rivalHits = 0
  const rivalCount = new Map()
  for (const row of valid) {
    if (row.brand?.mentioned) brandHits += 1
    for (const rival of row.rivals ?? []) {
      rivalHits += 1
      rivalCount.set(rival.name, (rivalCount.get(rival.name) ?? 0) + 1)
    }
  }
  const sov = brandHits + rivalHits > 0 ? brandHits / (brandHits + rivalHits) : 0

  const domainCount = new Map()
  for (const row of valid) {
    for (const domain of row.citedDomains ?? []) {
      domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1)
    }
  }
  const domains = [...domainCount.entries()]
    .map(([domain, count]) => ({ domain, count, share: pct(count / Math.max(1, n)) }))
    .sort((a, b) => b.count - a.count)

  const issueCount = { cuisine: 0, stores: 0, founded: 0 }
  for (const row of valid) {
    for (const issue of row.issues ?? []) {
      if (issue.id in issueCount) issueCount[issue.id] += 1
    }
  }

  const perPrompt = prompts.map(prompt => {
    const rows = valid.filter(row => row.promptId === prompt.id)
    const hit = rows.filter(row => row.brand?.mentioned && !row.brand?.negated)
    const ranks = rows.map(row => row.brand?.rank).filter(value => typeof value === 'number')
    return {
      id: prompt.id,
      text: prompt.text,
      intent: prompt.intent,
      weight: prompt.weight,
      n: rows.length,
      mentions: hit.length,
      rate: rows.length ? pct(hit.length / rows.length) : 0,
      avgRank: ranks.length ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10 : null,
      issues: rows.reduce((sum, row) => sum + (row.issues?.length ?? 0), 0),
      domains: [...new Set(rows.flatMap(row => row.citedDomains ?? []))].slice(0, 6),
    }
  })

  const intentKeys = [...new Set(prompts.map(prompt => prompt.intent))]
  const byIntent = intentKeys.map(intent => {
    const rows = perPrompt.filter(row => row.intent === intent)
    const sample = rows.reduce((sum, row) => sum + row.n, 0)
    const hit = rows.reduce((sum, row) => sum + row.mentions, 0)
    const rate = sample ? hit / sample : 0
    return {
      intent,
      n: sample,
      rate: pct(rate),
      ci: wilson(rate, sample),
      prompts: rows.length,
      covered: rows.filter(row => row.mentions > 0).length,
    }
  })

  const rate = n ? mentions.length / n : 0

  // 品牌词问题（问句里直接点名）回答里出现品牌是必然的，会把整体提及率抬高。
  // 对外只报「非品牌词提及率」——那才是「AI 会不会主动想到你」。
  const brandedIds = new Set(prompts.filter(prompt => prompt.branded).map(prompt => prompt.id))
  const split = rows => {
    const sample = rows.length
    const hit = rows.filter(row => row.brand?.mentioned && !row.brand?.negated).length
    const ranks = rows.filter(row => typeof row.brand?.rank === 'number')
    const top = ranks.filter(row => row.brand.rank <= 3).length
    const p = sample ? hit / sample : 0
    return {
      n: sample,
      mention: { rate: pct(p), ci: wilson(p, sample), count: hit },
      top3: { rate: pct(sample ? top / sample : 0), count: top, ranked: ranks.length },
    }
  }
  const nonBrand = split(valid.filter(row => !brandedIds.has(row.promptId)))
  const brandWord = split(valid.filter(row => brandedIds.has(row.promptId)))

  return {
    n,
    samples: answers.length,
    runAt: valid[0]?.at ?? null,
    engine: valid[0]?.engine ?? null,
    mention: { rate: pct(rate), ci: wilson(rate, n), count: mentions.length },
    nonBrand,
    brandWord,
    top3: { rate: pct(ranked.length ? top3.length / n : 0), count: top3.length, ranked: ranked.length },
    top1: { count: top1.length },
    avgRank: ranked.length
      ? Math.round((ranked.reduce((sum, row) => sum + row.brand.rank, 0) / ranked.length) * 10) / 10
      : null,
    sov: { rate: pct(sov), brandHits, rivalHits },
    citation: { rate: pct(citing.length / Math.max(1, n)), owned: pct(owned.length / Math.max(1, n)) },
    accuracy: { rate: pct(1 - errored.length / Math.max(1, n)), issues: issueCount, wrongAnswers: errored.length },
    competitors: [...rivalCount.entries()]
      .map(([name, count]) => ({ name, count, share: pct(count / Math.max(1, n)) }))
      .sort((a, b) => b.count - a.count),
    domains,
    byIntent,
    perPrompt,
    promptCount: prompts.length,
    client,
  }
}

/**
 * 诊断：把「没被提到 / 被提但靠后 / 说错话」三类缺口归因到信源。
 * @param {object} metrics - summarize() 的结果。
 * @param {object[]} answers - 原始答案。
 * @param {object[]} prompts - 问题库。
 * @returns {{ gaps: object[], sources: object[], headline: object }} 缺口单。
 */
export function diagnose(metrics, answers, prompts) {
  const brandedIds = new Set(prompts.filter(prompt => prompt.branded).map(prompt => prompt.id))
  // 「完全没提到」只看非品牌词问题：问句里点了名的，没提到是另一个问题，不该混在一起。
  const absent = metrics.perPrompt.filter(row => !brandedIds.has(row.id) && row.n > 0 && row.mentions === 0)
  // 「有时提到有时不提」：同一批采样里既有命中又有落空，说明资料不够硬。
  const weak = metrics.perPrompt.filter(row => row.n > 1 && row.mentions > 0 && row.mentions < row.n)
  const wrong = metrics.perPrompt.filter(row => row.issues > 0)

  const absentIds = new Set(absent.map(row => row.id))
  const domainCount = new Map()
  for (const row of answers) {
    if (!absentIds.has(row.promptId)) continue
    for (const domain of row.citedDomains ?? []) {
      domainCount.set(domain, (domainCount.get(domain) ?? 0) + 1)
    }
  }
  const sources = [...domainCount.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12)

  const gaps = [
    {
      kind: 'source',
      title: `有 ${absent.length} 个问题完全没提到我们`,
      detail: '这些问题的答案里，被引用的页面没有一篇是我们的。要么我们没内容，要么内容不在 AI 会引的地方。',
      items: absent.slice(0, 12).map(row => ({
        id: row.id,
        text: row.text,
        hint: row.domains.filter(domain => domain.includes('.') && !domain.startsWith('sitemap')).slice(0, 2).join('、'),
      })),
      action: '按下面的信源清单位置占位：先在流量最大的 3 个站点各写 1 篇，14 天后复测。',
    },
    {
      kind: 'rank',
      title: `有 ${weak.length} 个问题提了，但比例不到一半`,
      detail: '说明有内容基础，但不够「确定」——AI 有时想到、有时想不到，通常是资料不够结构化或更新太慢。',
      items: weak.slice(0, 12).map(row => ({ id: row.id, text: row.text, hint: `${row.rate}%` })),
      action: '把这几条问题对应的内容做成「结论 + 参数 + FAQ」结构，补齐人均、包间数、营业时间。',
    },
    {
      kind: 'fact',
      title: `有 ${wrong.length} 个问题的答案说错了事实`,
      detail: '说错比不提更伤：客户看到错误的人均或菜系，会直接放弃。',
      items: wrong.slice(0, 12).map(row => ({ id: row.id, text: row.text, hint: `${row.issues} 处` })),
      action: '先修事实卡 → 再同步点评/地图/百科/官网，让 AI 拿到的版本一致。',
    },
  ]

  return {
    gaps,
    sources,
    headline: {
      absent: absent.length,
      weak: weak.length,
      wrong: wrong.length,
      total: prompts.length,
    },
  }
}
