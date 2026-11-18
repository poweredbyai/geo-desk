// dsh-geo-desk · Host 半片
// GEO 工作台演示：问题库 → 采样 → 指标 → 诊断 → 报告，全链路落盘。
// 数据放在 $DSH_HOME/geo-desk/clients/<slug>/，报告同时可通过 /geo-desk/report.html 打开。

import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CLIENT, COMPETITORS, PROMPTS } from './src/seed.js'
import { ENGINE, probe, resolveSearchKey } from './src/engine.js'
import { summarize, diagnose } from './src/metrics.js'
import { buildInsights } from './src/insights.js'
import { buildActions } from './src/actions.js'
import { renderReport } from './src/report.js'

const CONCURRENCY = 4
const DEFAULT_SAMPLES = 2

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function clientRoot(slug = CLIENT.slug) {
  return join(dshHome(), 'geo-desk', 'clients', slug)
}

const paths = () => ({
  root: clientRoot(),
  answers: join(clientRoot(), 'answers.jsonl'),
  metrics: join(clientRoot(), 'metrics.json'),
  state: join(clientRoot(), 'state.json'),
})

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64_000) throw new Error('请求太大')
    chunks.push(chunk)
  }
  if (!chunks.length) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

async function readJsonFile(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonFile(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await writeFile(file, await readFile(tmp, 'utf8'))
}

async function readAnswers() {
  try {
    const raw = await readFile(paths().answers, 'utf8')
    return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// 运行状态（内存 + state.json；同一时间只跑一轮，演示够用）
// ---------------------------------------------------------------------------

/** @type {{ id: string, status: string, total: number, done: number, failed: number, samples: number, startedAt: string, finishedAt: string|null, error: string|null }} */
const run = {
  id: '',
  status: 'idle',
  total: 0,
  done: 0,
  failed: 0,
  samples: DEFAULT_SAMPLES,
  startedAt: '',
  finishedAt: null,
  error: null,
}

let flushQueue = Promise.resolve()

function appendAnswer(record) {
  flushQueue = flushQueue.then(async () => {
    await mkdir(paths().root, { recursive: true })
    await writeFile(paths().answers, `${JSON.stringify(record)}\n`, { flag: 'a' })
  }).catch(() => {})
  return flushQueue
}

/**
 * 用固定并发跑完一批采样。
 * @param {object} ctx - 插件上下文。
 * @param {number} samples - 每个问题采几次。
 * @returns {Promise<void>}
 */
async function runBatch(ctx, samples) {
  const key = await resolveSearchKey(ctx)
  if (!key) throw new Error('缺少 TAVILY_API_KEY，先写到 $DSH_HOME/.env')
  const tasks = []
  for (const prompt of PROMPTS) {
    for (let sample = 1; sample <= samples; sample += 1) tasks.push({ prompt, sample })
  }
  run.total = tasks.length
  run.done = 0
  run.failed = 0
  await mkdir(paths().root, { recursive: true })
  await writeFile(paths().answers, '')
  await writeJsonFile(paths().state, { run, startedAt: run.startedAt })

  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      const { prompt, sample } = tasks[index]
      const record = await probe(ctx, { key, prompt, client: CLIENT, competitors: COMPETITORS, sample })
      await appendAnswer(record)
      run.done += 1
      if (!record.ok) run.failed += 1
      if (run.done % 10 === 0) await writeJsonFile(paths().state, { run })
    }
  })
  await Promise.all(workers)
  run.status = 'done'
  run.finishedAt = new Date().toISOString()
  await writeJsonFile(paths().state, { run })
}

function startRun(ctx, samples) {
  if (run.status === 'running') return { started: false, run }
  run.id = randomUUID()
  run.status = 'running'
  run.samples = samples
  run.startedAt = new Date().toISOString()
  run.finishedAt = null
  run.error = null
  run.total = PROMPTS.length * samples
  run.done = 0
  run.failed = 0
  runBatch(ctx, samples).catch(async error => {
    run.status = 'failed'
    run.error = String(error?.message ?? error)
    run.finishedAt = new Date().toISOString()
    await writeJsonFile(paths().state, { run })
  })
  return { started: true, run }
}

async function computeAll() {
  const answers = await readAnswers()
  const valid = answers.filter(row => row.ok !== false)
  if (!valid.length) return null
  const metrics = summarize(answers, PROMPTS, CLIENT)
  const diagnosis = diagnose(metrics, answers, PROMPTS)
  const insights = buildInsights(answers, PROMPTS, CLIENT)
  const actions = buildActions({ metrics, insights, prompts: PROMPTS, answers, client: CLIENT })
  return { answers, metrics, diagnosis, insights, actions }
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------

async function route(ctx, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/geo-desk\/?/, '')
  const method = req.method || 'GET'

  if (method === 'GET' && path === 'state') {
    const stored = await readJsonFile(paths().state, null)
    const computed = await computeAll()
    return json(res, 200, {
      client: CLIENT,
      competitors: COMPETITORS,
      prompts: PROMPTS,
      engine: ENGINE,
      run: stored?.run ?? run,
      metrics: computed?.metrics ?? null,
      diagnosis: computed?.diagnosis ?? null,
      insights: computed?.insights ?? null,
      actions: computed?.actions ?? null,
      model: ctx.get('agentDefaultModel')?.currentSelection()?.model ?? null,
      reportUrl: '/geo-desk/report.html',
    })
  }

  if (method === 'GET' && path === 'answers') {
    const promptId = url.searchParams.get('promptId')
    const answers = await readAnswers()
    const rows = promptId ? answers.filter(row => row.promptId === promptId) : answers
    return json(res, 200, { rows })
  }

  if (method === 'GET' && path === 'report.html') {
    const computed = await computeAll()
    if (!computed) {
      res.statusCode = 404
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      return res.end('还没有采样数据，先在面板里跑一轮。')
    }
    const html = renderReport(computed.metrics, computed.diagnosis, computed.insights, computed.actions, {
      generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      engine: ENGINE.name,
      engineNote: ENGINE.note,
      samples: run.samples || DEFAULT_SAMPLES,
    })
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    return res.end(html)
  }

  if (method !== 'POST') return json(res, 405, { error: '不支持的方法' })

  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return json(res, 403, { error: '拒绝跨站请求' })

  if (path === 'run') {
    const result = startRun(ctx, DEFAULT_SAMPLES)
    return json(res, 200, result)
  }
  if (path === 'log') {
    // 面板的「黑匣子」：前端把关键节点写进文件，出问题时不用开 DevTools 也能定位。
    const body = await readJsonBody(req)
    const line = `${new Date().toISOString()} ${String(body?.message ?? '').slice(0, 500)}\n`
    await mkdir(paths().root, { recursive: true })
    await writeFile(join(paths().root, 'client.log'), line, { flag: 'a' })
    return json(res, 200, { ok: true })
  }
  if (path === 'report') {
    const computed = await computeAll()
    if (!computed) return json(res, 400, { error: '还没有数据，先跑一轮' })
    const dir = join(paths().root, 'reports')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = join(dir, `report-${stamp}.html`)
    const html = renderReport(computed.metrics, computed.diagnosis, computed.insights, computed.actions, {
      generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
      engine: ENGINE.name,
      engineNote: ENGINE.note,
      samples: run.samples || DEFAULT_SAMPLES,
    })
    await writeFile(file, html, 'utf8')
    return json(res, 200, { path: file, url: '/geo-desk/report.html' })
  }
  return json(res, 404, { error: '接口不存在' })
}

/** Web 服务不替插件路由鉴权：每个请求都自己走一遍 Host/Origin 与登录凭证检查。 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = 'dsh-geo-desk'
export const inject = ['webServer', 'connection']

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/geo-desk',
    handler: async (req, res) => {
      try {
        const rejection = requestRejection(ctx, req)
        if (rejection) {
          json(res, rejection, { error: '未授权' })
          return
        }
        await route(ctx, req, res)
      } catch (error) {
        if (res.headersSent) {
          res.end()
          return
        }
        json(res, 500, { error: error?.message ?? '服务器出错了' })
      }
    },
  }), 'dsh-geo-desk: /geo-desk routes')

  // 无浏览器的环境里怎么触发一轮：写 $DSH_HOME/geo-desk/auto-run.json 再让插件重新激活。
  // 文件读一次就删，跑一次算一次。
  void bootstrap(ctx)
}

/**
 * 启动检查：有 auto-run.json 就跑一轮，然后把它删掉。
 * @param {object} ctx - 插件上下文。
 * @returns {Promise<void>}
 */
async function bootstrap(ctx) {
  const marker = join(dshHome(), 'geo-desk', 'auto-run.json')
  let options
  try {
    options = JSON.parse(await readFile(marker, 'utf8'))
  } catch {
    return
  }
  await unlink(marker).catch(() => {})
  startRun(ctx, Number(options?.samples) || DEFAULT_SAMPLES)
}


/** 供外部脚本/测试直接调用的一轮采样。 */
export async function runOnce(ctx, samples = DEFAULT_SAMPLES) {
  run.id = randomUUID()
  run.status = 'running'
  run.startedAt = new Date().toISOString()
  await runBatch(ctx, samples)
  return run
}
