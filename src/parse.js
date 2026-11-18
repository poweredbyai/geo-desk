// geo-desk · 答案解析：品牌命中、推荐位次、竞品、引用、事实冲突
// 只用正则和字符串处理，纯函数，方便单测和「解析器升级后重算历史数据」。

const BRAND_NEGATIONS = ['不如', '没有', '不建议', '踩雷', '避雷', '不推荐', '差评']

/** 归一化：全角转半角标点、压空白，但保留换行（列表结构靠它）。 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 文本里第一次出现某个名字的位置；找不到返回 -1。 */
function firstIndexOf(text, name) {
  return text.indexOf(name)
}

/** 该位置前后 12 个字里有没有否定词——「不如这家」不算正提及。 */
function negatedAt(text, index) {
  const window = text.slice(Math.max(0, index - 12), index)
  return BRAND_NEGATIONS.some(word => window.includes(word))
}

/**
 * 把答案切成「列表项」，用于算推荐位次。
 * 认三种写法：`1. xxx`、`- xxx`、`**名字**：xxx`。
 */
function listItems(text) {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const items = []
  for (const line of lines) {
    if (/^(?:\d{1,2}\s*[.、)）]|[-•·*]\s)/.test(line)) items.push(line)
    else if (/^\*\*[^*]{2,20}\*\*/.test(line)) items.push(line)
  }
  return items
}

/**
 * 品牌命中：是否出现、出现在第几条推荐、是否被否定。
 * @param {string} text - 归一化后的答案。
 * @param {object} client - 客户档案（含 aliases）。
 * @returns {{mentioned: boolean, index: number, rank: number|null, negated: boolean, hits: number}}
 */
export function findBrand(text, client) {
  let best = -1
  let negated = false
  let hits = 0
  for (const alias of client.aliases) {
    let cursor = 0
    for (;;) {
      const at = text.indexOf(alias, cursor)
      if (at < 0) break
      hits += 1
      if (best < 0 || at < best) {
        best = at
        negated = negatedAt(text, at)
      }
      cursor = at + alias.length
    }
  }
  if (best < 0) return { mentioned: false, index: -1, rank: null, negated: false, hits: 0 }

  const items = listItems(text)
  let rank = null
  if (items.length >= 3) {
    const at = items.findIndex(item => client.aliases.some(alias => item.includes(alias)))
    if (at >= 0) rank = at + 1
  }
  return { mentioned: true, index: best, rank, negated, hits }
}

/**
 * 答案里出现了哪些同行。
 * @param {string} text - 归一化后的答案。
 * @param {string[]} competitors - 竞品名单。
 * @returns {{name: string, index: number}[]} 按首次出现位置排序。
 */
export function findCompetitors(text, competitors) {
  const found = []
  for (const name of competitors) {
    const at = firstIndexOf(text, name)
    if (at >= 0) found.push({ name, index: at })
  }
  return found.sort((a, b) => a.index - b.index)
}

/** 答案里的 `[1]` `[2]` 这类引用标记，去重后按出现顺序。 */
export function extractCites(text) {
  const seen = new Set()
  for (const match of text.matchAll(/\[(\d{1,2})\]/g)) seen.add(Number(match[1]))
  return [...seen].sort((a, b) => a - b)
}

/**
 * 事实校验：AI 把菜系 / 门店数 / 创立年份说错的，单独记一笔。
 * 只查「说错」，不查「没说」——没说只是信息不全，说错才是风险。
 * @param {string} text - 归一化后的答案。
 * @param {object} client - 客户档案。
 * @returns {{id: string, label: string, expect: string, got: string}[]} 冲突项。
 */
export function checkFacts(text, client) {
  const issues = []
  const saysYue = /粤菜/.test(text)
  const saysChaoshan = /(潮汕|潮州|潮菜)/.test(text)
  if (saysYue && !saysChaoshan) {
    issues.push({ id: 'cuisine', label: '菜系', expect: '潮汕菜', got: '粤菜' })
  }
  const stores = /(\d{1,2})\s*家\s*(?:门店|店|分店)/.exec(text)
  if (stores && Number(stores[1]) !== client.stores) {
    issues.push({ id: 'stores', label: '门店数', expect: `${client.stores} 家`, got: `${stores[1]} 家` })
  }
  const founded = /((?:19|20)\d{2})\s*年\s*(?:创立|成立|开业)/.exec(text)
  if (founded && Number(founded[1]) !== client.founded) {
    issues.push({ id: 'founded', label: '创立年份', expect: `${client.founded} 年`, got: `${founded[1]} 年` })
  }
  return issues
}

/** 从 URL 取域名，用于信源统计。 */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

/**
 * 一条答案的全部分析结果。
 * @param {string} raw - 模型原始答案。
 * @param {object} client - 客户档案。
 * @param {string[]} competitors - 竞品名单。
 * @param {object[]} sources - 本次检索到的资料 [{ n, url, title, snippet }]
 * @returns {object} 结构化结果，直接进 answers.jsonl。
 */
export function analyzeAnswer(raw, client, competitors, sources) {
  const text = normalize(raw)
  const brand = findBrand(text, client)
  const rivals = findCompetitors(text, competitors)
  const cites = extractCites(text)
  const issues = checkFacts(text, client)
  const cited = cites
    .map(n => sources.find(source => source.n === n))
    .filter(Boolean)
  const brandInSources = sources.filter(source =>
    client.aliases.some(alias => `${source.title ?? ''}${source.url ?? ''}`.includes(alias)))
  return {
    brand,
    rivals,
    cites,
    issues,
    citedDomains: cited.map(source => domainOf(source.url)),
    citedBrandSources: brandInSources.length,
    chars: text.length,
  }
}
