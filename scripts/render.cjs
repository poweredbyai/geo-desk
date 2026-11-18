// 离线渲染：读 demo/answers.jsonl → 算指标/洞察/行动 → 写 HTML 报告 → 截图 PNG。
// 用途：不依赖浏览器会话，验证「数据 → 报告」这一段是否成立。
// 运行：$env:NODE_PATH="$env:DSH_PROFILE_DIR\node_modules"; node scripts/render.cjs
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { join } = require('node:path')

const root = join(__dirname, '..')
const outDir = join(root, 'reports')

async function main() {
  const answers = (await readFile(join(root, 'demo', 'answers.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line))
  const { CLIENT, PROMPTS } = await import('../src/seed.js')
  const { summarize, diagnose } = await import('../src/metrics.js')
  const { buildInsights } = await import('../src/insights.js')
  const { buildActions } = await import('../src/actions.js')
  const { renderReport } = await import('../src/report.js')

  const metrics = summarize(answers, PROMPTS, CLIENT)
  const diagnosis = diagnose(metrics, answers, PROMPTS)
  const insights = buildInsights(answers, PROMPTS, CLIENT)
  const actions = buildActions({ metrics, insights, prompts: PROMPTS, answers, client: CLIENT })
  const html = renderReport(metrics, diagnosis, insights, actions, {
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    engine: 'Proxy-Web（Tavily 检索 + 模型复述）',
    engineNote: '演示引擎：检索前 8 条网页 → 模型按消费者视角组织答案。接真实引擎后指标与报告不变。',
    samples: Math.max(...answers.map(row => row.sample || 1)),
  })
  await mkdir(outDir, { recursive: true })
  const file = join(outDir, 'demo-baseline.html')
  await writeFile(file, html, 'utf8')

  console.log(JSON.stringify({
    file,
    answers: answers.length,
    valid: metrics.n,
    failed: answers.filter(row => row.ok === false).length,
    nonBrand: [metrics.nonBrand.mention.rate, metrics.nonBrand.mention.ci.low, metrics.nonBrand.mention.ci.high],
    brandWord: metrics.brandWord.mention.rate,
    sov: metrics.sov.rate,
    accuracy: metrics.accuracy.rate,
    absent: diagnosis.headline.absent,
    actions: actions.items.map(row => `${row.priority}:${row.title.slice(0, 18)}`),
  }, null, 2))

  // 截图：报告是给客户看的，得先自己看一眼排版
  try {
    const { chromium } = require('playwright')
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1000, height: 1400 }, deviceScaleFactor: 2 })
    await page.goto(`file:///${file.replace(/\\/g, '/')}`, { waitUntil: 'load' })
    await page.screenshot({ path: join(outDir, 'demo-baseline.png'), fullPage: true })
    await browser.close()
    console.log('png ok')
  } catch (error) {
    console.log('png skipped:', error.message.slice(0, 120))
  }
}

main().catch(error => { console.error(error); process.exit(1) })
