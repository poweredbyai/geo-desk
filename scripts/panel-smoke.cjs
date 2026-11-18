// 面板冒烟测试：用假的 React 渲染四个屏，确认没有运行时报错（不含样式验证）。
// 运行：node scripts/panel-smoke.cjs
const { readFile } = require('node:fs/promises')
const { join: pathJoin } = require('node:path')
const { homedir } = require('node:os')
const { join } = require('node:path')

const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')

function fakeReact() {
  const hooks = { state: 0 }
  class Component {
    constructor(props) { this.props = props || {}; this.state = {} }
    setState(next) { this.state = { ...this.state, ...next } }
  }
  return {
    Component,
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
    Fragment: 'fragment',
    hooks,
  }
}

async function main() {
  const source = await readFile(join(__dirname, '..', 'src', 'panel.js'), 'utf8')
  const React = fakeReact()
  const h = React.createElement
  // 与 build.mjs 相同的装配方式：面板源码在一个函数作用域里执行
  const factory = new Function('React', 'h', `${source}\nreturn { GeoPanel, GdOverview, GdPrompts, GdMonitor, GdInsight, GdAction, GdActionCard, GdReport, GdAnswerRow, GdGapRow, GdEmpty, GeoIcon };`)
  const ui = factory(React, h)

  const answers = (await readFile(join(__dirname, '..', 'demo', 'answers.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(JSON.parse)
  const { CLIENT, PROMPTS, COMPETITORS } = await import('../src/seed.js')
  const { summarize, diagnose } = await import('../src/metrics.js')
  const { buildInsights } = await import('../src/insights.js')
  const { buildActions } = await import('../src/actions.js')
  const metrics = summarize(answers, PROMPTS, CLIENT)
  const diagnosis = diagnose(metrics, answers, PROMPTS)
  const insights = buildInsights(answers, PROMPTS, CLIENT)
  const actions = buildActions({ metrics, insights, prompts: PROMPTS, answers, client: CLIENT })

  const data = {
    client: CLIENT,
    competitors: COMPETITORS,
    prompts: PROMPTS,
    engine: { id: 'proxy-web', name: 'Proxy-Web（检索 + 模型复述）', note: '演示引擎' },
    run: { status: 'done', done: 120, total: 120, failed: 7, error: null },
    metrics,
    diagnosis,
    insights,
    actions,
    model: 'deepseek-v4.1-flash',
    reportUrl: '/geo-desk/report.html',
  }

  const probes = {
    GdOverview: ui.GdOverview({ data, onRun: () => {}, busy: false }),
    // 空数据分支
    GdEmpty: ui.GdEmpty({ onRun: () => {}, busy: false }),
    GdPrompts: ui.GdPrompts({ data }),
    GdMonitor: ui.GdMonitor({ data }),
    GdInsight: ui.GdInsight({ data }),
    GdAction: ui.GdAction({ data }),
    GdActionCard: ui.GdActionCard({ action: actions.items[0] }),
    GdReport: ui.GdReport({ data, onExport: () => {} }),
    GdAnswerRow: ui.GdAnswerRow({ row: answers[0] }),
    GdGapRow: ui.GdGapRow({ gap: diagnosis.gaps[0] }),
    GeoIcon: ui.GeoIcon({ size: 20, active: true }),
    GeoPanel: ui.GeoPanel(),
  }
  for (const [name, tree] of Object.entries(probes)) {
    if (!tree || typeof tree !== 'object' || !tree.type) throw new Error(`${name} 没有渲染出元素`)
    console.log(`${name}: ok (${tree.type})`)
  }
  console.log('panel smoke: passed')
}

main().catch(error => { console.error('panel smoke FAILED:', error); process.exit(1) })
