// geo-desk · 洞察层：AI 在引谁、偏好什么、我们缺哪一块
// 全部从 answers.jsonl 的原文与 sources 推出来，不额外调用模型。

/** 域名 → 信源类型。分类决定「能不能运营」，比单纯排名有价值。 */
const ROLE_RULES = [
  { role: 'guide', label: '榜单 / 指南', match: /michelin|guide|ranking|top\d|best|awards|dianping|meituan|openrice|tripadvisor/i },
  { role: 'wiki', label: '百科', match: /baike|wikipedia|wiki/i },
  { role: 'review', label: '点评 / 预订', match: /dianping|meituan|koubei|yelp|tripadvisor|openrice|chope|dingwei/i },
  { role: 'video', label: '视频', match: /youtube|bilibili|douyin|ixigua|v\.qq\.com|youku|kuaishou/i },
  { role: 'ugc', label: '社区 / 问答', match: /zhihu|xiaohongshu|xhs|douban|tieba|weibo|reddit/i },
  { role: 'travel', label: '旅行 / 攻略', match: /ctrip|trip\.com|mafengwo|qunar|lvyou|travel/i },
  { role: 'media', label: '媒体 / 聚合', match: /sohu|sina|thepaper|163\.com|qq\.com|ifeng|xinhuanet|people\.com|toutiao|baijiahao|36kr|jiemian|yicai|nfnews|southcn|gzwxb|nfapp/i },
  { role: 'map', label: '地图 / POI', match: /maps\.|amap|map\.baidu|ditu|google\.com\/maps/i },
  { role: 'social', label: '社交', match: /facebook|instagram|twitter|x\.com|linkedin/i },
]

const ROLE_META = {
  guide: { label: '榜单 / 指南', actionable: '难', note: '榜单由编辑/评审决定，只能靠长期口碑与投稿' },
  wiki: { label: '百科', actionable: '半', note: '可提交修正，但审核慢，适合纠错不适合营销' },
  review: { label: '点评 / 预订', actionable: '半', note: '不能刷，但商家页信息、菜单、图片可以补全' },
  video: { label: '视频', actionable: '易', note: '自有账号可运营，探店/后厨/招牌菜最好出片' },
  ugc: { label: '社区 / 问答', actionable: '易', note: '小红书笔记、知乎回答都可自运营，最容易被引' },
  travel: { label: '旅行 / 攻略', actionable: '半', note: '攻略站可投稿，适合外地客场景' },
  map: { label: '地图 / POI', actionable: '易', note: '门店 POI 可自己维护，地址电话营业时间必须一致' },
  media: { label: '媒体 / 聚合', actionable: '易', note: '清单体文章的主阵地，可投放也可供稿' },
  social: { label: '社交', actionable: '难', note: '海外平台，本地餐饮用处有限' },
  official: { label: '官网 / 自有', actionable: '易', note: '完全可控，但需要结构化才容易被抓' },
  other: { label: '其他', actionable: '未知', note: '未识别的站点' },
}

/**
 * 分类一个域名。
 * @param {string} domain - 主机名。
 * @param {string} brandPinyin - 品牌拼音片段，用于识别官网。
 * @param {string} brandPinyin - 品牌拼音片段，用于识别官网（示例仓库用 demo-brand）。
 * @returns {{role: string, label: string, actionable: string, note: string}} 分类结果。
 */
export function classifyDomain(domain, brandPinyin = 'demo-brand') {
  if (domain.includes(brandPinyin)) return { role: 'official', ...ROLE_META.official }
  for (const rule of ROLE_RULES) {
    if (rule.match.test(domain)) return { role: rule.role, ...ROLE_META[rule.role] }
  }
  return { role: 'other', ...ROLE_META.other }
}

const FIELD_RULES = [
  { key: 'price', label: '人均 / 价格', match: /人均|元\/人|¥\s?\d+|\d+\s?元/ },
  { key: 'location', label: '位置 / 商圈', match: /位于|地址|地铁|商圈|路|街|广场|中心/ },
  { key: 'room', label: '包间', match: /包间|包厢|房间/ },
  { key: 'dish', label: '招牌菜', match: /招牌|必点|推荐菜|特色菜|卤水|生腌|打冷/ },
  { key: 'hours', label: '营业时间', match: /营业时间|营业到|点前|宵夜|午市|晚市/ },
  { key: 'rating', label: '口碑 / 评分', match: /评分|好评|必吃榜|米其林|黑珍珠|点评/ },
  { key: 'parking', label: '停车', match: /停车|车位/ },
]

const SENTENCE_SPLIT = /(?<=[。！？；\n])/

/**
 * 抽取「被引用的句子」：带 [n] 标记的那一句，以及它落在哪个域名上。
 * @param {object} answer - answers.jsonl 的一条记录。
 * @returns {{text: string, n: number, domain: string}[]} 被引句。
 */
function citedSentences(answer) {
  const sources = answer.sources || []
  const out = []
  for (const sentence of String(answer.answer || '').split(SENTENCE_SPLIT)) {
    const marks = [...sentence.matchAll(/\[(\d{1,2})\]/g)].map(hit => Number(hit[1]))
    if (!marks.length) continue
    const clean = sentence.replace(/\[\d{1,2}\]/g, '').trim()
    if (clean.length < 8) continue
    for (const n of marks.slice(0, 2)) {
      const source = sources.find(row => row.n === n)
      out.push({ text: clean.slice(0, 120), n, domain: domainOf(source?.url) })
    }
  }
  return out
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

/**
 * 生成洞察。
 * @param {object[]} answers - 有效答案。
 * @param {object[]} prompts - 问题库。
 * @param {object} client - 客户档案。
 * @returns {object} 面板与报告共用的洞察对象。
 */
export function buildInsights(answers, prompts, client) {
  const promptById = new Map(prompts.map(row => [row.id, row]))
  const valid = answers.filter(row => row && row.ok !== false && row.answer)

  // ── 域名台账：谁在提供答案，我们能不能动它
  const domainMap = new Map()
  for (const row of valid) {
    for (const domain of new Set(row.citedDomains || [])) {
      if (!domainMap.has(domain)) {
        const info = classifyDomain(domain)
        domainMap.set(domain, { domain, ...info, count: 0, intents: {}, brand: 0, rival: 0 })
      }
      const entry = domainMap.get(domain)
      entry.count += 1
      const intent = promptById.get(row.promptId)?.intent ?? 'other'
      entry.intents[intent] = (entry.intents[intent] || 0) + 1
      if (row.brand?.mentioned) entry.brand += 1
      if ((row.rivals || []).length) entry.rival += 1
    }
  }
  const domains = [...domainMap.values()]
    .map(row => ({
      ...row,
      share: Math.round((row.count / Math.max(1, valid.length)) * 1000) / 10,
      brandRate: Math.round((row.brand / Math.max(1, row.count)) * 100),
      rivalRate: Math.round((row.rival / Math.max(1, row.count)) * 100),
    }))
    .sort((a, b) => b.count - a.count)

  // ── 引用偏好矩阵：什么类型的问题，AI 更爱引什么源
  const roleTotals = {}
  const matrix = {}
  for (const row of valid) {
    const intent = promptById.get(row.promptId)?.intent ?? 'other'
    for (const domain of new Set(row.citedDomains || [])) {
      const role = classifyDomain(domain).role
      roleTotals[role] = (roleTotals[role] || 0) + 1
      if (!matrix[intent]) matrix[intent] = { intent, total: 0, roles: {} }
      matrix[intent].roles[role] = (matrix[intent].roles[role] || 0) + 1
      matrix[intent].total += 1
    }
  }
  const pairs = Object.values(roleTotals).reduce((sum, value) => sum + value, 0)
  const roles = Object.entries(roleTotals)
    .map(([role, count]) => ({
      role,
      label: ROLE_META[role]?.label ?? role,
      actionable: ROLE_META[role]?.actionable ?? '未知',
      note: ROLE_META[role]?.note ?? '',
      count,
      share: Math.round((count / Math.max(1, pairs)) * 1000) / 10,
    }))
    .sort((a, b) => b.count - a.count)

  const preference = Object.values(matrix)
    .map(row => {
      const ranked = Object.entries(row.roles)
        .filter(([role]) => role !== 'other' && role !== 'social')
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([role, count]) => ({
          role,
          label: ROLE_META[role]?.label ?? role,
          share: Math.round((count / Math.max(1, row.total)) * 100),
        }))
      return {
        intent: row.intent,
        total: row.total,
        topRole: ranked[0]?.role ?? 'other',
        topLabel: ranked[0]?.label ?? '其他',
        topShare: ranked[0]?.share ?? 0,
        topRoles: ranked,
      }
    })
    .sort((a, b) => b.total - a.total)

  // ── AI 讲一家店时，习惯带哪些字段（决定我们的内容要写全什么）
  const fields = FIELD_RULES.map(rule => {
    const hit = valid.filter(row => rule.match.test(String(row.answer || ''))).length
    return { key: rule.key, label: rule.label, rate: Math.round((hit / Math.max(1, valid.length)) * 100) }
  }).sort((a, b) => b.rate - a.rate)

  // ── 被引句：AI 实际抄走的是哪一句
  const sentences = valid.flatMap(citedSentences)
  const withNumber = sentences.filter(row => /\d/.test(row.text)).length
  const withPrice = sentences.filter(row => /人均|元|¥/.test(row.text)).length
  const withRank = sentences.filter(row => /第|top|榜|推荐|必吃|米其林/i.test(row.text)).length
  const sentenceStats = {
    total: sentences.length,
    avgLen: sentences.length
      ? Math.round(sentences.reduce((sum, row) => sum + row.text.length, 0) / sentences.length)
      : 0,
    numberRate: Math.round((withNumber / Math.max(1, sentences.length)) * 100),
    priceRate: Math.round((withPrice / Math.max(1, sentences.length)) * 100),
    rankRate: Math.round((withRank / Math.max(1, sentences.length)) * 100),
  }
  const samples = sentences
    .filter(row => row.text.length >= 16)
    .slice(0, 12)

  // ── 缺口：哪些可运营的源我们一次都没占到
  const gaps = domains
    .filter(row => row.count >= 3 && row.brandRate <= 20 && ['media', 'video', 'ugc', 'travel', 'review'].includes(row.role))
    .slice(0, 8)

  return { domains, roles, preference, fields, sentenceStats, samples, gaps, matrix }
}
