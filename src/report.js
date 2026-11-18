// geo-desk · 报告：把指标与诊断渲染成一页可直接发给客户的 HTML。
// 不含外部资源（字体、图表库都不引），单文件可离线打开、可直接打印成 PDF。

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const pct = value => `${value}%`

function bar(value, max, color = '#0F5C4B') {
  const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return `<div class="bar"><span style="width:${width}%;background:${color}"></span></div>`
}

function metricCard(label, value, unit, note) {
  return `<div class="card">
    <div class="card-label">${esc(label)}</div>
    <div class="card-value">${esc(value)}<span class="unit">${esc(unit)}</span></div>
    <div class="card-note">${esc(note)}</div>
  </div>`
}

/**
 * 生成报告 HTML。
 * @param {object} metrics - summarize() 的结果。
 * @param {object} diagnosis - diagnose() 的结果。
 * @param {object} meta - { generatedAt, client, engine, samples }
 * @returns {string} 完整 HTML。
 */
export function renderReport(metrics, diagnosis, insights, actions, meta) {
  const client = metrics.client
  const roleRows = (insights?.roles ?? []).map(row => `<tr>
      <td>${esc(row.label)}</td>
      <td class="num">${row.count}</td>
      <td style="width:36%">${bar(row.count, Math.max(1, ...(insights?.roles ?? []).map(r => r.count)))}</td>
      <td class="num muted">${pct(row.share)}</td>
      <td class="muted">${esc(row.actionable)}</td>
    </tr>`).join('')

  const prefRows = (insights?.preference ?? []).map(row => `<tr>
      <td>${esc(intentName(row.intent))}</td>
      <td>${(row.topRoles ?? []).map(role => `${esc(role.label)} <span class="muted">${pct(role.share)}</span>`).join(' · ')}</td>
    </tr>`).join('')

  const fieldRows = (insights?.fields ?? []).map(row => `<tr>
      <td>${esc(row.label)}</td>
      <td class="num">${pct(row.rate)}</td>
      <td style="width:40%">${bar(row.rate, 100, '#7A8B6F')}</td>
    </tr>`).join('')

  const actionCards = (actions?.items ?? []).map(action => `<div class="gap">
      <div class="gap-head">
        <span class="tag">${esc(action.priority)}</span>
        <strong>${esc(action.title)}</strong>
        <span class="muted">${esc(action.effort)}</span>
      </div>
      <p class="gap-detail">${esc(action.why)}</p>
      ${action.targets.length > 0 ? `<ul class="gap-items">${action.targets.slice(0, 5).map(item => `<li><span class="mono">${esc(item.id)}</span> ${esc(item.text)}${item.note ? `<em>${esc(item.note)}</em>` : ''}</li>`).join('')}</ul>` : ''}
      <div class="brief">
        <div class="brief-line"><b>写什么</b>${esc(action.brief.headline)}</div>
        <div class="brief-line"><b>结构</b>${action.brief.structure.map(line => esc(line)).join('；')}</div>
        <div class="brief-line"><b>必须包含</b>${(action.brief.must ?? []).map(esc).join('、')}</div>
        <div class="brief-line"><b>发到哪</b>${esc(action.channel)}</div>
      </div>
      <p class="gap-action">验收：${esc(action.acceptance)}</p>
    </div>`).join('')

  const intentRows = metrics.byIntent.map(row => `<tr>
      <td>${esc(intentName(row.intent))}</td>
      <td class="num">${row.prompts}</td>
      <td class="num">${row.n}</td>
      <td class="num strong">${pct(row.rate)}</td>
      <td class="num muted">${row.ci.low}–${row.ci.high}</td>
      <td class="num">${row.covered}/${row.prompts}</td>
    </tr>`).join('')

  const maxRival = Math.max(1, ...metrics.competitors.slice(0, 10).map(row => row.count))
  const rivalRows = metrics.competitors.slice(0, 10).map(row => `<tr>
      <td>${esc(row.name)}</td>
      <td class="num">${row.count}</td>
      <td style="width:46%">${bar(row.count, maxRival, '#B4593A')}</td>
      <td class="num muted">${pct(row.share)}</td>
    </tr>`).join('')

  const maxDomain = Math.max(1, ...metrics.domains.slice(0, 10).map(row => row.count))
  const domainRows = metrics.domains.slice(0, 10).map(row => `<tr>
      <td>${esc(row.domain)}</td>
      <td class="num">${row.count}</td>
      <td style="width:46%">${bar(row.count, maxDomain)}</td>
    </tr>`).join('')

  const promptRows = metrics.perPrompt.map(row => `<tr>
      <td class="mono">${esc(row.id)}</td>
      <td>${esc(row.text)}</td>
      <td class="muted">${esc(intentName(row.intent))}</td>
      <td class="num ${row.mentions === 0 ? 'bad' : row.rate >= 50 ? 'good' : ''}">${pct(row.rate)}</td>
      <td class="num">${row.avgRank ?? '—'}</td>
      <td class="num ${row.issues > 0 ? 'bad' : ''}">${row.issues || '—'}</td>
    </tr>`).join('')

  const gapBlocks = diagnosis.gaps.map(gap => `<div class="gap">
      <div class="gap-head">
        <span class="tag">${esc(gapKind(gap.kind))}</span>
        <strong>${esc(gap.title)}</strong>
      </div>
      <p class="gap-detail">${esc(gap.detail)}</p>
      <ul class="gap-items">
        ${gap.items.map(item => `<li><span class="mono">${esc(item.id)}</span> ${esc(item.text)}${item.hint ? `<em>${esc(item.hint)}</em>` : ''}</li>`).join('')}
      </ul>
      <p class="gap-action">→ ${esc(gap.action)}</p>
    </div>`).join('')

  const sourceList = diagnosis.sources.length
    ? diagnosis.sources.map(row => `<li>${esc(row.domain)} <em>${row.count} 次</em></li>`).join('')
    : '<li>本轮没有可统计的引用来源</li>'

  const head = `${client.brand} · AI 搜索可见度报告`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(head)}</title>
<style>
  :root { --ink:#1B1A17; --ink2:#5C564C; --line:#DED7C9; --paper:#FBF9F4; --leaf:#0F5C4B; --clay:#B4593A; }
  * { box-sizing: border-box; }
  body { margin:0; background:#EFEBE1; color:var(--ink); font-family:"Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; line-height:1.6; }
  .page { max-width: 900px; margin: 0 auto; background: var(--paper); padding: 56px 64px 72px; }
  header.top { border-bottom:2px solid var(--ink); padding-bottom:20px; margin-bottom:28px; }
  .kicker { font-size:12px; letter-spacing:.22em; color:var(--ink2); text-transform:uppercase; }
  h1 { font-size:30px; line-height:1.25; margin:10px 0 6px; letter-spacing:.01em; }
  .sub { color:var(--ink2); font-size:13.5px; }
  h2 { font-size:17px; margin:44px 0 12px; padding-left:10px; border-left:4px solid var(--leaf); }
  p { margin:8px 0; }
  .lead { font-size:15px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0 8px; }
  .card { border:1px solid var(--line); padding:14px 14px 12px; background:#fff; }
  .card-label { font-size:12px; color:var(--ink2); letter-spacing:.06em; }
  .card-value { font-size:28px; font-weight:700; letter-spacing:-.01em; margin-top:2px; }
  .unit { font-size:13px; font-weight:400; color:var(--ink2); margin-left:2px; }
  .card-note { font-size:11.5px; color:var(--ink2); margin-top:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin:8px 0 4px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:11.5px; letter-spacing:.08em; color:var(--ink2); font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--ink2); }
  .muted { color:var(--ink2); }
  .strong { font-weight:700; }
  .good { color:var(--leaf); font-weight:700; }
  .bad { color:var(--clay); font-weight:700; }
  .bar { height:9px; background:#EAE4D8; display:block; }
  .bar span { display:block; height:100%; }
  .gap { border:1px solid var(--line); background:#fff; padding:16px 18px; margin:14px 0; }
  .gap-head { display:flex; gap:10px; align-items:baseline; }
  .tag { font-size:11px; letter-spacing:.1em; background:var(--ink); color:#fff; padding:2px 7px; }
  .gap-detail { color:var(--ink2); font-size:13px; }
  .gap-items { margin:8px 0; padding-left:18px; font-size:13px; }
  .gap-items li { margin:3px 0; }
  .gap-items em { color:var(--ink2); font-style:normal; font-size:12px; margin-left:8px; }
  .gap-action { font-size:13px; color:var(--leaf); font-weight:600; }
  .callout { border-left:3px solid var(--clay); background:#F5EEE6; padding:12px 16px; font-size:13px; margin:16px 0; }
  .foot { margin-top:52px; border-top:1px solid var(--line); padding-top:14px; font-size:11.5px; color:var(--ink2); }
  h3.sub { font-size:13.5px; margin:24px 0 6px; color:var(--ink2); letter-spacing:.04em; }
  .brief { border-top:1px dashed var(--line); margin-top:10px; padding-top:8px; font-size:12.5px; }
  .brief-line { margin:3px 0; color:var(--ink2); }
  .brief-line b { color:var(--ink); margin-right:8px; font-weight:600; }
  .focus { border:1px solid var(--ink); background:#fff; padding:14px 18px; margin:14px 0; }
  .focus-title { font-size:11.5px; letter-spacing:.14em; color:var(--ink2); margin-bottom:6px; }
  ul.plain { margin:8px 0; padding-left:18px; font-size:13px; }
  @media print { body { background:#fff } .page { max-width:none; padding:0 } h2 { break-after:avoid } tr { break-inside:avoid } }
</style>
</head>
<body>
<div class="page">

<header class="top">
  <div class="kicker">GEO / AI 搜索可见度 · 首轮基线</div>
  <h1>${esc(client.brand)} 在 AI 搜索里的可见度</h1>
  <div class="sub">${esc(client.city)} · ${esc(client.category)} · 生成于 ${esc(meta.generatedAt)} · 引擎：${esc(meta.engine)}</div>
</header>

<section>
  <p class="lead">本轮在 ${metrics.promptCount} 个真实用户问题上采集了 ${metrics.n} 个有效答案。
  在<strong>没有点品牌名</strong>的 ${metrics.nonBrand.n} 个答案里，品牌被主动提到的比例是
  <strong>${pct(metrics.nonBrand.mention.rate)}</strong>（95% 区间 ${metrics.nonBrand.mention.ci.low}–${metrics.nonBrand.mention.ci.high}%），
  这就是「AI 会不会想到你」的真实水平。点名提问的 ${metrics.brandWord.n} 个答案里提到率是 ${pct(metrics.brandWord.mention.rate)}%，
  那说明的是「AI 认不认识你」，两件事要分开看。
  ${metrics.accuracy.issues.cuisine + metrics.accuracy.issues.stores + metrics.accuracy.issues.founded > 0
    ? `另有 ${metrics.accuracy.wrongAnswers} 个答案说错了事实，这部分比「没被提到」更急。`
    : '本轮没有发现事实性错误。'}</p>
</section>

<h2>一、四个核心指标</h2>
<div class="grid">
  ${metricCard('非品牌词提及率', metrics.nonBrand.mention.rate, '%', `区间 ${metrics.nonBrand.mention.ci.low}–${metrics.nonBrand.mention.ci.high}% · n=${metrics.nonBrand.n}`)}
  ${metricCard('非品牌词进前三', metrics.nonBrand.top3.rate, '%', `${metrics.nonBrand.top3.count} 条进前三 · ${metrics.nonBrand.top3.ranked} 条能识别位次`)}
  ${metricCard('声量份额 SOV', metrics.sov.rate, '%', `本品牌 ${metrics.sov.brandHits} 次 vs 同行 ${metrics.sov.rivalHits} 次`)}
  ${metricCard('信息准确率', metrics.accuracy.rate, '%', `${metrics.accuracy.wrongAnswers} 个答案有冲突`)}
</div>
<p class="muted" style="font-size:12.5px">口径：提及率 = 提到本品牌的答案 / 有效答案；推荐前三只统计能识别出列表结构的答案；准确率只查「说错」，不查「没说」。品牌验证类问题问句里点了名，提及率天然接近 100%，所以不进入上面的主指标。</p>

<h2>二、分意图看，问题出在哪</h2>
<table>
  <thead><tr><th>意图</th><th class="num">问题数</th><th class="num">样本</th><th class="num">提及率</th><th class="num">95% 区间</th><th class="num">有提及</th></tr></thead>
  <tbody>${intentRows}</tbody>
</table>

<h2>三、谁在被推荐</h2>
<table>
  <thead><tr><th>同行</th><th class="num">出现次数</th><th>对比</th><th class="num">占样本比</th></tr></thead>
  <tbody>${rivalRows || '<tr><td colspan="4" class="muted">本轮没有识别到同行</td></tr>'}</tbody>
</table>

<h2>四、AI 的引用偏好：它信谁、抄哪句</h2>
<p class="muted" style="font-size:12.5px">这一节回答「AI 从哪学来的」。看懂了才知道内容该往哪放，而不是凭感觉发稿。</p>
<h3 class="sub">4.1 信源类型结构</h3>
<table>
  <thead><tr><th>信源类型</th><th class="num">被引次数</th><th>占比</th><th class="num">占全部引用</th><th>可运营性</th></tr></thead>
  <tbody>${roleRows || '<tr><td colspan="5" class="muted">本轮没有可统计的引用</td></tr>'}</tbody>
</table>
<p class="muted" style="font-size:12.5px">可运营性：易 = 自己能发（社区、视频、媒体供稿、地图 POI）；半 = 只能补信息不能主导（点评、百科）；难 = 靠长期口碑（榜单）。</p>

<h3 class="sub">4.2 什么类型的问题，AI 更爱引什么</h3>
<table>
  <thead><tr><th>问题类型</th><th>主要引用来源（前三）</th></tr></thead>
  <tbody>${prefRows || '<tr><td colspan="2" class="muted">没有数据</td></tr>'}</tbody>
</table>

<h3 class="sub">4.3 AI 推荐一家店时，习惯带哪些信息</h3>
<table>
  <thead><tr><th>字段</th><th class="num">出现率</th><th>对比</th></tr></thead>
  <tbody>${fieldRows}</tbody>
</table>
<div class="callout">出现率低 = AI 普遍答不上来 = 机会。<strong>包间、停车、营业时间</strong>这几项 AI 基本不给，
但餐饮决策恰恰最看这几条——哪个品牌把这些信息写成可被摘录的句子，哪个品牌就先被引用。</div>

<h3 class="sub">4.4 AI 实际抄走的是哪一句</h3>
<p class="muted" style="font-size:12.5px">本轮共识别 ${insights?.sentenceStats?.total ?? 0} 个带引用标记的句子，
平均 ${insights?.sentenceStats?.avgLen ?? 0} 字；其中 ${pct(insights?.sentenceStats?.numberRate ?? 0)} 带数字、
${pct(insights?.sentenceStats?.priceRate ?? 0)} 带人均、${pct(insights?.sentenceStats?.rankRate ?? 0)} 带排名或推荐语。
它抄的是判断句，不是形容词。</p>
<ul class="plain">${(insights?.samples ?? []).slice(0, 6).map(row => `<li>${esc(row.text)} <em class="muted">— ${esc(row.domain)}</em></li>`).join('')}</ul>

<h3 class="sub">4.5 被引域名明细</h3>
<table>
  <thead><tr><th>域名</th><th class="num">被引次数</th><th>对比</th></tr></thead>
  <tbody>${domainRows || '<tr><td colspan="3" class="muted">本轮没有可统计的引用</td></tr>'}</tbody>
</table>
<div class="callout">被引用的页面里，属于本品牌的比例是 <strong>${pct(metrics.citation.owned)}</strong>。
这个数字低，说明「AI 想推荐你，但没有材料可引」——这正是内容要补的位置。</div>

<h2>五、诊断：三类缺口</h2>
${gapBlocks}

<h2>六、行动方案</h2>
<p class="muted" style="font-size:12.5px">每条动作都带三样东西：为什么做（数据）、写什么（brief）、怎么算做成（验收）。先做 P0，再做 P1。</p>
<div class="focus">
  <div class="focus-title">本周先做这三件</div>
  <ol class="plain">${(actions?.focus ?? []).map(row => `<li><strong>${esc(row.title)}</strong></li>`).join('') || '<li>暂无</li>'}</ol>
</div>
${actionCards || '<p class="muted">还没有生成动作</p>'}

<h2>七、问题明细</h2>
<table>
  <thead><tr><th>编号</th><th>问题</th><th>意图</th><th class="num">提及率</th><th class="num">平均位次</th><th class="num">事实冲突</th></tr></thead>
  <tbody>${promptRows}</tbody>
</table>

<h2>八、口径与限制</h2>
<ul class="plain">
  <li><strong>引擎：${esc(meta.engine)}。</strong>${esc(meta.engineNote)}</li>
  <li>样本：${metrics.promptCount} 个问题 × ${meta.samples} 次 = ${metrics.samples} 条请求，有效 ${metrics.n} 条。</li>
  <li>所有比例都给 95% Wilson 区间；单条问题的样本量小，只看「有没有」不看具体点数。</li>
  <li>AI 答案不稳定，同一问题多次结果会不同。本报告的所有数字都是「这一轮」的观测值，不是永久状态。</li>
  <li>本报告不含流量归因：AI 答案不带 UTM，到店效果要用品牌词搜索、团购核销、到店问卷另行验证。</li>
</ul>

<div class="foot">
  ${esc(client.brand)} · 首轮基线 · ${esc(meta.generatedAt)}<br>
  由 GEO Desk 生成 · 数据源：${esc(meta.engine)} · 可在下一轮复测时对比同一批问题
</div>

</div>
</body>
</html>`
}

function intentName(key) {
  return {
    discover: '品类发现',
    scene: '场景',
    compare: '对比 / 榜单',
    solve: '问题解决',
    verify: '品牌验证',
  }[key] ?? key
}

function gapKind(kind) {
  return { source: '信源缺口', rank: '强度不足', fact: '事实错误' }[kind] ?? kind
}
