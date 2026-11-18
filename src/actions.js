// geo-desk · 行动层：把「缺口 + 洞察」翻译成能派给人的活
// 每条动作都要能回答三个问题：为什么做（数据）、做什么（brief）、怎么算做成（验收）。

const INTENT_ACTION = {
  discover: {
    form: '清单体长文',
    channel: '媒体 / 聚合站（搜狐、新浪、澎湃类）',
    angle: '「广州吃潮汕菜怎么选」这类问题，AI 需要一份能直接抄的名单',
  },
  scene: {
    form: '场景文 + 实拍图',
    channel: '小红书笔记 + 公众号',
    angle: '场景问题靠"具体到能坐几个人、人均多少、有没有包间"取胜',
  },
  solve: {
    form: '科普问答',
    channel: '知乎回答 + 公众号',
    angle: '这类问题不涉及品牌，纯科普就能进答案，是性价比最高的一块',
  },
  compare: {
    form: '对比评测',
    channel: '知乎 + 行业媒体',
    angle: '对比类问题已经能看到我们，要做的是把"第几位"往前推',
  },
  verify: {
    form: '品牌事实页',
    channel: '官网 + 点评商家页 + 百科',
    angle: '点名提问时最怕说错，先把事实统一',
  },
}

const INTENT_LABEL = {
  discover: '品类发现',
  scene: '场景',
  compare: '对比 / 榜单',
  solve: '问题解决',
  verify: '品牌验证',
}

/**
 * 生成动作清单。
 * @param {object} input - { metrics, insights, prompts, answers, client }
 * @returns {{ items: object[], focus: object[] }} 动作卡与「先做这三件」。
 */
export function buildActions({ metrics, insights, prompts, answers, client }) {
  const promptById = new Map(prompts.map(row => [row.id, row]))
  const items = []
  const fields = insights.fields.filter(field => field.rate >= 35).map(field => field.label)
  const topChannel = insights.gaps.slice(0, 3).map(row => row.domain)

  // ── 1. 事实纠偏：说错话比不提更伤，永远排最前
  const factRows = metrics.perPrompt.filter(row => row.issues > 0)
  if (factRows.length > 0) {
    const cuisineCount = metrics.accuracy.issues.cuisine
    items.push({
      id: 'act-fact',
      type: 'fact',
      priority: 'P0',
      score: 100 + factRows.length,
      title: cuisineCount > 0 ? `统一「潮汕菜」口径，止住 ${cuisineCount} 次菜系误判` : '修正答案里的事实错误',
      why: `${factRows.length} 个问题、共 ${metrics.accuracy.issues.cuisine + metrics.accuracy.issues.stores + metrics.accuracy.issues.founded} 条答案出现事实冲突（菜系 ${metrics.accuracy.issues.cuisine}、门店数 ${metrics.accuracy.issues.stores}、年份 ${metrics.accuracy.issues.founded}）。`
        + 'AI 会把不同来源的旧信息混在一起，只要有一处写成「粤菜」，它就会在粤菜的问题池里找别人。',
      targets: factRows.slice(0, 8).map(row => ({ id: row.id, text: row.text, note: `${row.issues} 处` })),
      channel: '点评商家页 · 百科 · 地图 POI · 公众号简介 · 官网',
      form: '同一套事实，五个渠道改一遍',
      brief: {
        headline: '把「潮汕菜（潮州菜）」写进每个渠道的第一句',
        structure: [
          '首段第一句：品牌名 + 潮汕菜（潮州菜）+ 城市 + 创立年份',
          '第二句：招牌（卤水、生腌、打冷、明档海鲜）',
          '第三句：门店数与所在商圈',
          '全文不要只写「粤菜」；如果必须提，写成「潮汕菜，属粤菜三大菜系之一」',
        ],
        must: ['潮汕菜 / 潮州菜', `${client.founded} 年创立`, `广州 ${client.stores} 家门店`, '卤水拼盘', '生腌', '打冷'],
      },
      acceptance: `复测时菜系冲突 ≤ 1 条；品牌词问题里出现「潮汕」的比例 ≥ 90%（当前 ${metrics.accuracy.rate}% 准确率）`,
      effort: '0.5 人天',
      status: 'todo',
    })
  }

  // ── 2. 按意图补内容：每一组缺口一张卡
  const absent = metrics.perPrompt.filter(row => {
    const prompt = promptById.get(row.id)
    return prompt && !prompt.branded && row.mentions === 0
  })
  const byIntent = new Map()
  for (const row of absent) {
    const intent = promptById.get(row.id)?.intent ?? 'discover'
    if (!byIntent.has(intent)) byIntent.set(intent, [])
    byIntent.get(intent).push(row)
  }

  for (const [intent, rows] of [...byIntent.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const spec = INTENT_ACTION[intent] ?? INTENT_ACTION.discover
    const weight = rows.reduce((sum, row) => sum + (promptById.get(row.id)?.weight ?? 1), 0)
    const pieces = Math.max(1, Math.ceil(rows.length / 3))
    const currentRate = metrics.byIntent.find(row => row.intent === intent)?.rate ?? 0
    items.push({
      id: `act-${intent}`,
      type: 'content',
      priority: rows.length >= 6 ? 'P1' : 'P2',
      score: Math.round(weight * 10) + rows.length,
      title: `${INTENT_LABEL[intent]}：补 ${pieces} 篇${spec.form}，打掉 ${rows.length} 个空白问题`,
      why: `${rows.length} 个问题在采样里一次都没提到我们（该意图当前提及率 ${currentRate}%）。`
        + spec.angle,
      targets: rows.slice(0, 6).map(row => ({ id: row.id, text: row.text, note: '' })),
      channel: spec.channel,
      form: spec.form,
      brief: {
        headline: rows[0]?.text ?? '',
        structure: [
          '开头 100 字内直接回答，不要铺垫',
          `正文按「${fields.slice(0, 4).join(' / ')}」分维度写，每个维度一句结论`,
          '至少给 5 个具体选项，我们排在第 2–3 位（第一位太硬，容易被判广告）',
          '末尾放 5 条 FAQ，把用户的下一个问题也答掉',
        ],
        must: fields.slice(0, 5),
      },
      acceptance: `14 天后该组 ${rows.length} 个问题的提及率 ≥ 30%（当前 ${currentRate}%）`,
      effort: `${pieces} 篇 × 0.5 人天`,
      status: 'todo',
    })
  }

  // ── 3. 信源占位：按「可运营 + 我们没占到」挑源
  const gapDomains = insights.gaps.slice(0, 3)
  if (gapDomains.length > 0) {
    items.push({
      id: 'act-source',
      type: 'source',
      priority: 'P1',
      score: 80 + gapDomains.length,
      title: `在 ${gapDomains.map(row => row.domain).join('、')} 上占位`,
      why: '这些站点被 AI 反复引用，但在引用它们的答案里我们出现的比例很低：'
        + gapDomains.map(row => `${row.domain}（${row.count} 次，我方 ${row.brandRate}%）`).join('；')
        + '。内容不缺，缺的是放在 AI 会看的地方。',
      targets: [],
      channel: gapDomains.map(row => `${row.domain}（${row.label}，可运营性：${row.actionable}）`).join(' / '),
      form: '供稿 / 投稿 / 自有账号矩阵',
      brief: {
        headline: `优先 ${topChannel[0] ?? '媒体聚合站'}`,
        structure: [
          '清单体优先：标题带「N 家 + 怎么选 + 人均」',
          '正文里给可被直接抄走的句子：人均、包间数、招牌、停车',
          '同一篇内容改写三个版本，分别投三类站，不要原文重复',
        ],
        must: fields.slice(0, 4),
      },
      acceptance: '这 3 个站点上「提到本品牌」的引用比例从当前水平提升到 40% 以上',
      effort: '3 篇 × 0.5 人天',
      status: 'todo',
    })
  }

  // ── 4. 结构优化：AI 抄走的是哪种句子
  if (insights.sentenceStats.total > 0) {
    const stats = insights.sentenceStats
    items.push({
      id: 'act-structure',
      type: 'structure',
      priority: 'P2',
      score: 60,
      title: '把「可被抄走的句子」写进每篇内容',
      why: `AI 实际引用的 ${stats.total} 个句子里，${stats.numberRate}% 带数字、${stats.priceRate}% 带人均、${stats.rankRate}% 带排名或推荐语。`
        + '它抄的是判断句，不是形容词。',
      targets: [],
      channel: '所有内容（写作规范）',
      form: '写作规范',
      brief: {
        headline: '一句话一个事实，数字优先',
        structure: [
          '每个选项一行，格式：店名 + 一句判断（带数字）+ 适合谁',
          '判断句长度控制在 40 字以内，主语明确',
          '避免「环境优雅、菜品精致、服务周到」这类没有信息的句子',
        ],
        must: ['人均', '包间数', '招牌菜名', '位置/地铁', '适合场景'],
      },
      acceptance: '下一批复测里，含数字的被引句占比提升 10 个百分点',
      effort: '一次性，写进内容规范',
      status: 'todo',
    })
  }

  // 先看优先级，再看分值：P0 永远在最前面
  const RANK = { P0: 0, P1: 1, P2: 2 }
  items.sort((a, b) => (RANK[a.priority] - RANK[b.priority]) || (b.score - a.score))
  const focus = items.slice(0, 3).map(row => ({ id: row.id, title: row.title, why: row.why.slice(0, 60) }))
  return { items, focus, stats: { absent: absent.length, total: prompts.length, fields } }
}
