// geo-desk · 引擎适配层
// 演示期只有一个实现：proxy-web（Tavily 检索 + 模型复述），模拟「联网搜索型答案引擎」。
// 豆包真实采样是下一个实现：接口一样，换了 probe() 内部即可，指标与报告都不用改。

import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { analyzeAnswer } from './parse.js'

const KEY_REF = 'TAVILY_API_KEY'
const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export const ENGINE = {
  id: 'proxy-web',
  name: 'Proxy-Web（检索 + 模型复述）',
  note: 'Tavily 检索前 8 条 → 模型按消费者视角组织答案。用来跑通链路，不等于豆包的真实输出。',
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

let dotenvCache = { mtimeMs: 0, values: null }

async function dotenvValues() {
  const file = join(dshHome(), '.env')
  let info
  try {
    info = await stat(file)
  } catch {
    return new Map()
  }
  if (dotenvCache.values && info.mtimeMs === dotenvCache.mtimeMs) return dotenvCache.values
  const values = new Map()
  try {
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2').trim()
      if (value) values.set(match[1], value)
    }
  } catch {
    // 读不到就当没配
  }
  dotenvCache = { mtimeMs: info.mtimeMs, values }
  return values
}

/**
 * 搜索用的 API key：credentials → 环境变量 → $DSH_HOME/.env。
 * @param {object} ctx - 插件上下文。
 * @returns {Promise<string | undefined>} key。
 */
export async function resolveSearchKey(ctx) {
  try {
    const credentials = ctx.get('credentials')
    const hit = await credentials?.resolve?.(KEY_REF)
    if (typeof hit?.value === 'string' && hit.value.trim()) return hit.value.trim()
  } catch {
    // 没有 credentials 服务：继续
  }
  const fromEnv = (process.env[KEY_REF] ?? '').trim()
  if (fromEnv) return fromEnv
  return (await dotenvValues()).get(KEY_REF) || undefined
}

/**
 * Tavily 检索，返回带编号的资料列表。
 * @param {string} key - Tavily API key。
 * @param {string} query - 用户问题原文。
 * @param {number} size - 取几条。
 * @param {AbortSignal} signal - 取消信号。
 * @returns {Promise<object[]>} [{ n, url, title, snippet }]
 */
export async function searchSources(key, query, size, signal) {
  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      max_results: size,
      search_depth: 'basic',
      topic: 'general',
      include_answer: false,
      include_raw_content: false,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`)
  const data = await response.json()
  const rows = Array.isArray(data?.results) ? data.results : []
  return rows
    .filter(row => row && typeof row.url === 'string')
    .map((row, index) => ({
      n: index + 1,
      url: row.url,
      title: typeof row.title === 'string' ? row.title : '',
      snippet: typeof row.content === 'string' ? row.content.slice(0, 500) : '',
    }))
}

const SYSTEM_PROMPT = `你是一个中文 AI 助手，正在回答用户的生活消费类问题。你会拿到一组刚检索到的网页资料。

像消费者真正看到的回答那样说话：
- 先用一句话给结论；
- 如果是推荐类问题，给 3 到 6 个具体选项，一行一个，写清店名、一句理由，以及资料里有的人均和位置；
- 不要写「根据资料」「以下是」「希望对你有帮助」这类话，直接说；
- 资料不足时可以用常识补充，但不要编造具体数字（人均、门店数、成立年份）；
- 用到的资料在句末标注 [编号]，可以标多个。

直接给答案，不要解释你在做什么。`

/**
 * 让模型按「消费者视角」把检索结果组织成答案。
 * @param {object} ctx - 插件上下文（需要 llm 服务）。
 * @param {{ prompt: string, city: string, sources: object[] }} input - 输入。
 * @param {AbortSignal} signal - 取消信号。
 * @returns {Promise<{ text: string, model: string }>} 答案与模型名。
 */
export async function composeAnswer(ctx, { prompt, city, sources }, signal) {
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  const llm = ctx.get('llm')
  if (!llm || !selection?.provider || !selection?.model) throw new Error('当前没有可用模型')
  const context = sources
    .map(source => `[${source.n}] ${source.title || source.url} — ${source.url}\n${source.snippet}`)
    .join('\n\n')
  const user = `问题：${prompt}\n城市：${city}\n\n资料：\n${context}`

  const call = await llm.prepareCall(
    { provider: selection.provider, model: selection.model, maxTokens: 900 },
    signal,
    (controls, model) => {
      const effort = model.reasoning?.efforts?.[0]?.id
      return { ...controls, ...(effort === undefined ? {} : { reasoningEffort: effort }) }
    },
  )
  const messages = [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'dsh-geo-desk' } }]
  let text = ''
  for await (const chunk of call.stream({
    ...call.config,
    system: SYSTEM_PROMPT,
    messages,
    sessionId: 'dsh-geo-desk-probe',
    signal,
  })) {
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
      throw new Error(chunk.reason.failure?.message || '模型调用失败')
    }
  }
  if (!text.trim()) throw new Error('模型没有输出内容')
  return { text: text.trim(), model: selection.model }
}

/**
 * 跑一次采样：检索 → 生成 → 解析。
 * 失败也返回一条记录（ok:false），否则报告里的分母会不诚实。
 * @param {object} ctx - 插件上下文。
 * @param {object} input - { key, prompt, client, competitors, samples, sample }
 * @returns {Promise<object>} 一条 answers 记录。
 */
export async function probe(ctx, { key, prompt, client, competitors, sample }) {
  const at = new Date().toISOString()
  const base = {
    id: `${prompt.id}-${sample}-${Date.now().toString(36)}`,
    promptId: prompt.id,
    prompt: prompt.text,
    intent: prompt.intent,
    sample,
    engine: ENGINE.id,
    at,
  }
  try {
    const sources = await searchSources(key, prompt.text, 8, AbortSignal.timeout(45_000))
    const { text, model } = await composeAnswer(ctx, { prompt: prompt.text, city: client.city, sources }, AbortSignal.timeout(120_000))
    const analysis = analyzeAnswer(text, client, competitors, sources)
    return {
      ...base,
      ok: true,
      model,
      answer: text,
      sources,
      ...analysis,
    }
  } catch (error) {
    return { ...base, ok: false, error: String(error?.message ?? error).slice(0, 200) }
  }
}
