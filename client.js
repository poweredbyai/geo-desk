window.__ModuleLoader__.load({
  id: 'dsh-geo-desk',
  factory(require) {
    const React = require('react')
    const h = React.createElement
// ---- src/panel.js ----
/* ============================================================
 * src/panel.js — GEO Desk 主面板
 * 与 main.js 共用一个工厂作用域（React、h 由外层提供），无 import/export。
 * 写法约定：每行的 h() 都在本行闭合，先把数组算好再渲染，避免深层嵌套。
 * ============================================================ */

const GD_INTENT = {
  discover: '品类发现',
  scene: '场景',
  compare: '对比 / 榜单',
  solve: '问题解决',
  verify: '品牌验证',
};

const GD_TABS = [
  { id: 'overview', label: '总览' },
  { id: 'prompts', label: '问题库' },
  { id: 'monitor', label: '监测' },
  { id: 'insight', label: '洞察' },
  { id: 'action', label: '行动' },
  { id: 'report', label: '报告' },
];

/** 统一请求：失败时把后端的中文错误抛出来。 */
async function gdFetch(path, options) {
  const response = await fetch(`geo-desk/${path}`, options);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error((body && body.error) || `请求失败（${response.status}）`);
  return body;
}

/** 面板黑匣子：关键节点写进 Host 的文件，出问题不用开 DevTools。 */
let gdLogged = false;
function gdLog(message) {
  try {
    fetch('geo-desk/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: String(message).slice(0, 400) }),
    }).catch(function () {});
  } catch (error) {
    // 日志失败不能影响面板
  }
}

/** 百分比显示。 */
function gdPct(value) {
  return typeof value === 'number' ? `${value}%` : '—';
}

function GdCard(props) {
  return h('div', { className: 'gd-card' },
    h('div', { className: 'gd-card-label' }, props.label),
    h('div', { className: 'gd-card-value' }, props.value, h('span', { className: 'gd-unit' }, props.unit || '')),
    h('div', { className: 'gd-card-note' }, props.note));
}

function GdBar(props) {
  const width = props.max > 0 ? Math.max(2, Math.round((props.value / props.max) * 100)) : 0;
  return h('div', { className: 'gd-bar' },
    h('span', { className: props.tone === 'clay' ? 'gd-fill-clay' : '', style: { width: `${width}%` } }));
}

function GdSection(props) {
  return h('section', { className: 'gd-section' },
    h('div', { className: 'gd-section-head' },
      h('h3', null, props.title),
      props.hint ? h('span', { className: 'gd-hint' }, props.hint) : null),
    props.children);
}

function GdGapRow(props) {
  const gap = props.gap;
  const items = (gap.items || []).slice(0, 4);
  const lines = items.map(item => h('li', { key: item.id },
    h('span', { className: 'gd-mono' }, item.id),
    ' ',
    item.text));
  return h('div', { className: 'gd-gap' },
    h('div', { className: 'gd-gap-title' }, gap.title),
    h('p', { className: 'gd-gap-detail' }, gap.detail),
    items.length > 0 ? h('ul', { className: 'gd-gap-items' }, lines) : null,
    h('p', { className: 'gd-gap-action' }, `→ ${gap.action}`));
}

function GdAnswerRow(props) {
  const row = props.row;
  const text = String(row.answer || row.error || '').slice(0, 220);
  const issues = (row.issues || []).length;
  const head = h('div', { className: 'gd-answer-head' },
    h('span', { className: row.brand && row.brand.mentioned ? 'gd-dot gd-dot-on' : 'gd-dot' }),
    h('span', { className: 'gd-answer-q' }, row.prompt),
    h('span', { className: 'gd-mono gd-muted' }, row.promptId),
    row.brand && row.brand.rank ? h('span', { className: 'gd-badge' }, `第 ${row.brand.rank} 位`) : null,
    issues > 0 ? h('span', { className: 'gd-badge gd-badge-warn' }, `${issues} 处说错`) : null);
  return h('div', { className: 'gd-answer' }, head, h('p', { className: 'gd-answer-text' }, text));
}

/** 一行「名字 + 条 + 数字」。 */
function GdBarRow(props) {
  const nameClass = props.mono ? 'gd-row-name gd-domain' : 'gd-row-name';
  return h('div', { className: 'gd-row' },
    h('span', { className: nameClass }, props.name),
    h('span', { className: 'gd-row-bar' }, h(GdBar, { value: props.value, max: props.max, tone: props.tone })),
    h('span', { className: 'gd-row-num' }, props.value));
}

function GdEmpty(props) {
  return h('div', { className: 'gd-empty' },
    h('div', { className: 'gd-empty-title' }, '还没有数据'),
    h('p', { className: 'gd-muted' },
      '这一轮会把 60 个问题各采样 2 次：检索前 8 条 → 模型按消费者视角组织答案 → 解析品牌、竞品、引用与事实冲突。大约 3–5 分钟。'),
    h('button', {
      className: 'gd-btn gd-btn-primary',
      disabled: props.busy,
      onClick: props.onRun,
    }, props.busy ? '正在跑…' : '跑第一轮'));
}

/** 出错时别把页面留白：把错误显示出来，方便一眼定位。 */
class GeoBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    gdLog(`crash: ${error && error.message}`);
  }

  render() {
    if (this.state.error) {
      const detail = String((this.state.error && this.state.error.stack) || this.state.error).slice(0, 900);
      return h('div', { className: 'gd-crash' },
        h('strong', null, 'GEO 工作台渲染出错'),
        h('pre', null, detail));
    }
    return this.props.children;
  }
}

/** 总览。 */
function GdOverview(props) {
  const data = props.data;
  const m = data.metrics;
  if (!m) return h(GdEmpty, { onRun: props.onRun, busy: props.busy });
  // Host 与 Client 可能短暂不同版本：旧 Host 没有 nonBrand，就退回整体口径。
  const nb = m.nonBrand || m;

  const cards = [
    h(GdCard, {
      key: 'mention',
      label: '非品牌词提及率',
      value: gdPct(nb.mention.rate),
      unit: '',
      note: `95% 区间 ${nb.mention.ci.low}–${nb.mention.ci.high}% · n=${nb.n}`,
    }),
    h(GdCard, {
      key: 'top3',
      label: '非品牌词进前三',
      value: gdPct(nb.top3.rate),
      note: `${nb.top3.count} 条进前三 · ${nb.top3.ranked} 条能识别位次`,
    }),
    h(GdCard, {
      key: 'sov',
      label: '声量份额',
      value: gdPct(m.sov.rate),
      note: `我方 ${m.sov.brandHits} 次 · 同行 ${m.sov.rivalHits} 次`,
    }),
    h(GdCard, {
      key: 'acc',
      label: '信息准确率',
      value: gdPct(m.accuracy.rate),
      note: `${m.accuracy.wrongAnswers} 个答案说错了事实`,
    }),
  ];

  const intentRows = m.byIntent.map(row => h('tr', { key: row.intent },
    h('td', null, GD_INTENT[row.intent] || row.intent),
    h('td', { className: 'gd-num' }, row.n),
    h('td', { className: 'gd-num gd-strong' }, gdPct(row.rate)),
    h('td', { className: 'gd-num gd-muted' }, `${row.covered}/${row.prompts}`)));

  const rivals = m.competitors.slice(0, 8);
  const maxRival = Math.max(1, ...rivals.map(row => row.count));
  const rivalRows = rivals.map(row => h(GdBarRow, {
    key: row.name, name: row.name, value: row.count, max: maxRival, tone: 'clay',
  }));

  const domains = m.domains.slice(0, 8);
  const maxDomain = Math.max(1, ...domains.map(row => row.count));
  const domainRows = domains.map(row => h(GdBarRow, {
    key: row.domain, name: row.domain, value: row.count, max: maxDomain, mono: true,
  }));

  const gapRows = ((data.diagnosis && data.diagnosis.gaps) || []).map(gap =>
    h(GdGapRow, { key: gap.kind, gap }));

  const intentTable = h('table', { className: 'gd-table' },
    h('thead', null, h('tr', null,
      h('th', null, '意图'),
      h('th', { className: 'gd-num' }, '样本'),
      h('th', { className: 'gd-num' }, '提及率'),
      h('th', { className: 'gd-num' }, '有提及的题'))),
    h('tbody', null, intentRows));

  const rivalSection = h(GdSection, { title: '谁在被推荐', hint: '按出现次数' },
    h('div', { className: 'gd-rows' },
      rivalRows.length > 0 ? rivalRows : h('p', { className: 'gd-muted' }, '本轮没有识别到同行')));

  const domainSection = h(GdSection, { title: 'AI 引用了哪些页面', hint: 'Top 8 域名' },
    h('div', { className: 'gd-rows' },
      domainRows.length > 0 ? domainRows : h('p', { className: 'gd-muted' }, '本轮没有可统计的引用')));

  return h('div', null,
    h('div', { className: 'gd-grid' }, cards),
    h(GdSection, { title: '分意图', hint: '哪一类问题最需要补' }, intentTable),
    h('div', { className: 'gd-two' }, rivalSection, domainSection),
    h(GdSection, {
      title: '诊断',
      hint: `${(data.diagnosis && data.diagnosis.headline && data.diagnosis.headline.absent) || 0} 个问题完全没提到`,
    }, h('div', { className: 'gd-gaps' }, gapRows)));
}

/** 问题库。 */
function GdPrompts(props) {
  const [intent, setIntent] = React.useState('all');
  const data = props.data;
  const prompts = data.prompts || [];
  const stats = (data.metrics && data.metrics.perPrompt) || [];
  const rows = intent === 'all' ? prompts : prompts.filter(row => row.intent === intent);

  const chips = [h('button', {
    key: 'all',
    className: intent === 'all' ? 'gd-chip gd-chip-on' : 'gd-chip',
    onClick: () => setIntent('all'),
  }, `全部 ${prompts.length}`)];

  Object.keys(GD_INTENT).forEach(key => {
    chips.push(h('button', {
      key,
      className: intent === key ? 'gd-chip gd-chip-on' : 'gd-chip',
      onClick: () => setIntent(key),
    }, GD_INTENT[key]));
  });

  const body = rows.map(row => {
    const stat = stats.find(item => item.id === row.id);
    let cellClass = 'gd-num gd-muted';
    if (stat) cellClass = stat.mentions === 0 ? 'gd-num gd-bad' : stat.rate >= 50 ? 'gd-num gd-good' : 'gd-num';
    return h('tr', { key: row.id },
      h('td', { className: 'gd-mono' }, row.id),
      h('td', null, row.text),
      h('td', { className: 'gd-muted' }, GD_INTENT[row.intent] || row.intent),
      h('td', { className: 'gd-muted' }, row.scene),
      h('td', { className: 'gd-num gd-muted' }, row.weight),
      h('td', { className: cellClass }, stat ? gdPct(stat.rate) : '—'));
  });

  return h('div', null,
    h('div', { className: 'gd-filters' }, chips),
    h('table', { className: 'gd-table gd-table-tight' },
      h('thead', null, h('tr', null,
        h('th', null, '编号'),
        h('th', null, '问题'),
        h('th', null, '意图'),
        h('th', null, '场景'),
        h('th', { className: 'gd-num' }, '权重'),
        h('th', { className: 'gd-num' }, '提及率'))),
      h('tbody', null, body)));
}

/** 监测。 */
function GdMonitor(props) {
  const data = props.data;
  const [rows, setRows] = React.useState([]);
  const running = data.run && data.run.status === 'running';

  React.useEffect(() => {
    let alive = true;
    gdFetch('answers')
      .then(body => { if (alive) setRows((body.rows || []).slice(-24).reverse()); })
      .catch(() => {});
    return () => { alive = false; };
  }, [data.run && data.run.done, data.run && data.run.status]);

  const total = (data.run && data.run.total) || 0;
  const done = (data.run && data.run.done) || 0;
  const progress = total ? Math.round((done / total) * 100) : 0;

  const line = h('div', { className: 'gd-runline' },
    h('span', { className: `gd-status gd-status-${(data.run && data.run.status) || 'idle'}` },
      (data.run && data.run.status) || 'idle'),
    h('span', { className: 'gd-muted' }, `${done} / ${total} 条`),
    data.run && data.run.failed ? h('span', { className: 'gd-bad' }, `失败 ${data.run.failed}`) : null,
    h('span', { className: 'gd-muted' }, `模型 ${data.model || '—'}`));

  const answerList = rows.length > 0
    ? h('div', { className: 'gd-answers' }, rows.map(row => h(GdAnswerRow, { key: row.id, row })))
    : h('p', { className: 'gd-muted' }, '还没有答案，先跑一轮。');

  return h('div', null,
    h(GdSection, { title: '本轮', hint: running ? '正在跑，关掉面板也不会中断' : '已结束' },
      line,
      h('div', { className: 'gd-progress' }, h('span', { style: { width: `${progress}%` } })),
      data.run && data.run.error ? h('p', { className: 'gd-bad' }, data.run.error) : null),
    h(GdSection, { title: '最近答案', hint: '绿色=提到本品牌，红色=没提到' }, answerList));
}

/** 洞察：AI 信谁、抄哪句、我们缺哪块。 */
function GdInsight(props) {
  const data = props.data;
  const ins = data.insights;
  if (!ins) return h('p', { className: 'gd-muted' }, '跑完一轮才有洞察。');

  const maxRole = Math.max(1, ...ins.roles.map(row => row.count));
  const roleRows = ins.roles.slice(0, 8).map(row => h('div', { className: 'gd-row', key: row.role },
    h('span', { className: 'gd-row-name' }, row.label),
    h('span', { className: 'gd-row-bar' }, h(GdBar, { value: row.count, max: maxRole })),
    h('span', { className: 'gd-row-num' }, `${row.share}%`)));

  const prefRows = ins.preference.map(row => h('tr', { key: row.intent },
    h('td', null, GD_INTENT[row.intent] || row.intent),
    h('td', { className: 'gd-muted' }, row.topRoles.map(role => `${role.label} ${role.share}%`).join(' · '))));

  const fieldRows = ins.fields.map(row => h('div', { className: 'gd-row', key: row.key },
    h('span', { className: 'gd-row-name' }, row.label),
    h('span', { className: 'gd-row-bar' }, h(GdBar, { value: row.rate, max: 100, tone: 'olive' })),
    h('span', { className: 'gd-row-num' }, `${row.rate}%`)));

  const stats = ins.sentenceStats;
  const statCards = [
    h(GdCard, { key: 'len', label: '被引句平均长度', value: stats.avgLen, unit: '字', note: `共 ${stats.total} 句` }),
    h(GdCard, { key: 'num', label: '带数字', value: `${stats.numberRate}%`, note: '数字是最好抄的锚点' }),
    h(GdCard, { key: 'price', label: '带人均', value: `${stats.priceRate}%`, note: '价格类事实最常被摘' }),
    h(GdCard, { key: 'rank', label: '带排名/推荐语', value: `${stats.rankRate}%`, note: '榜单式表达' }),
  ];

  const sampleList = ins.samples.slice(0, 5).map((row, index) => h('li', { key: index },
    row.text,
    h('em', { className: 'gd-muted' }, ` — ${row.domain}`)));

  const gapRows = ins.gaps.map(row => h('div', { className: 'gd-row', key: row.domain },
    h('span', { className: 'gd-row-name gd-domain' }, row.domain),
    h('span', { className: 'gd-muted' }, `${row.label} · 被引 ${row.count} 次 · 我方出现 ${row.brandRate}%`),
    h('span', { className: 'gd-row-num' }, row.actionable)));

  return h('div', null,
    h(GdSection, { title: 'AI 信谁', hint: '按信源类型统计（同一答案多个来源会各记一次）' },
      h('div', { className: 'gd-rows' }, roleRows)),
    h(GdSection, { title: '什么类型的问题，AI 更爱引什么', hint: '前三名' },
      h('table', { className: 'gd-table' },
        h('thead', null, h('tr', null, h('th', null, '问题类型'), h('th', null, '主要引用来源'))),
        h('tbody', null, prefRows))),
    h(GdSection, { title: 'AI 推荐一家店时，习惯带哪些信息', hint: '出现率低 = 机会' },
      h('div', { className: 'gd-rows' }, fieldRows)),
    h(GdSection, { title: 'AI 抄走的是哪一句', hint: '判断句，不是形容词' },
      h('div', { className: 'gd-grid' }, statCards),
      h('ul', { className: 'gd-list' }, sampleList)),
    h(GdSection, { title: '我们没占到的源', hint: '可运营 + 我方出现率低' },
      h('div', { className: 'gd-rows' }, gapRows.length > 0 ? gapRows : h('p', { className: 'gd-muted' }, '暂时没有明显缺口'))));
}

/** 一条动作卡。 */
function GdActionCard(props) {
  const action = props.action;
  const prioClass = action.priority === 'P0' ? 'gd-prio gd-prio-p0' : 'gd-prio';
  const targets = (action.targets || []).slice(0, 5).map(item => h('li', { key: item.id },
    h('span', { className: 'gd-mono' }, item.id),
    ' ',
    item.text));
  return h('div', { className: 'gd-action' },
    h('div', { className: 'gd-action-head' },
      h('span', { className: prioClass }, action.priority),
      h('strong', null, action.title),
      h('span', { className: 'gd-muted gd-small' }, action.effort)),
    h('p', { className: 'gd-gap-detail' }, action.why),
    targets.length > 0 ? h('ul', { className: 'gd-gap-items' }, targets) : null,
    h('div', { className: 'gd-brief' },
      h('div', { className: 'gd-brief-line' }, h('b', null, '写什么'), action.brief.headline),
      h('div', { className: 'gd-brief-line' }, h('b', null, '结构'), action.brief.structure.join('；')),
      h('div', { className: 'gd-brief-line' }, h('b', null, '必须包含'), (action.brief.must || []).join('、')),
      h('div', { className: 'gd-brief-line' }, h('b', null, '发到哪'), action.channel)),
    h('p', { className: 'gd-gap-action' }, `验收：${action.acceptance}`));
}

/** 行动：把缺口翻译成能派给活的清单。 */
function GdAction(props) {
  const data = props.data;
  const acts = data.actions;
  if (!acts) return h('p', { className: 'gd-muted' }, '跑完一轮才有行动方案。');
  const focus = h('ol', { className: 'gd-list' },
    acts.focus.map(row => h('li', { key: row.id }, h('strong', null, row.title))));
  return h('div', null,
    h('div', { className: 'gd-focus' },
      h('div', { className: 'gd-focus-title' }, '本周先做这三件'),
      focus),
    h('div', null, acts.items.map(action => h(GdActionCard, { key: action.id, action }))));
}
function GdReport(props) {
  const data = props.data;
  const ready = Boolean(data.metrics);
  const list = h('ul', { className: 'gd-list' },
    h('li', null, `引擎：${(data.engine && data.engine.name) || '—'}`),
    h('li', null, (data.engine && data.engine.note) || ''),
    h('li', null, '所有比例都给 95% Wilson 区间；单条问题样本少，只看有没有，不看点数。'),
    h('li', null, '不含流量归因：AI 答案不带 UTM，到店效果要用品牌词搜索、团购核销、问卷另行验证。'));

  const actions = h('div', { className: 'gd-actions' },
    h('button', {
      className: 'gd-btn gd-btn-primary',
      onClick: () => window.open('/geo-desk/report.html', '_blank'),
    }, '打开报告'),
    h('button', { className: 'gd-btn', onClick: props.onExport }, '导出到本地'));

  return h('div', null,
    h(GdSection, { title: '客户报告', hint: '一页 HTML，可打印成 PDF' },
      ready
        ? h('div', null,
          h('p', { className: 'gd-muted' },
            `覆盖 ${data.metrics.promptCount} 个问题、${data.metrics.n} 个有效答案。报告含口径、分意图、竞品、信源、诊断与问题明细。`),
          actions)
        : h('p', { className: 'gd-muted' }, '跑完一轮才能生成报告。')),
    h(GdSection, { title: '这份报告的口径', hint: '写给客户看的免责' }, list));
}

/** 主面板。 */
function GeoPanel() {
  const [data, setData] = React.useState(null);
  const [tab, setTab] = React.useState('overview');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');

  const load = React.useCallback(async () => {
    try {
      const body = await gdFetch('state');
      setData(body);
      setError('');
      if (!gdLogged) {
        gdLogged = true;
        gdLog(`state ok: prompts=${(body.prompts || []).length} metrics=${body.metrics ? 'yes' : 'no'} run=${body.run && body.run.status}`);
      }
    } catch (err) {
      setError(err.message);
      gdLog(`state failed: ${err.message}`);
    }
  }, []);

  React.useEffect(() => {
    gdLog('panel mounted');
    load();
  }, [load]);

  const running = Boolean(data && data.run && data.run.status === 'running');
  React.useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => { load(); }, 2000);
    return () => clearInterval(timer);
  }, [running, load]);

  const startRun = async () => {
    setBusy(true);
    setNotice('');
    try {
      await gdFetch('run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async () => {
    try {
      const body = await gdFetch('report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setNotice(`已导出：${body.path}`);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const done = data && data.run ? data.run.done : 0;
  const total = data && data.run ? data.run.total : 0;
  const runLabel = running ? `跑着呢 ${done}/${total}` : '跑一轮';

  const header = h('header', { className: 'gd-head' },
    h('div', null,
      h('div', { className: 'gd-kicker' }, 'GEO DESK · 内部工具 · v0.1.2'),
      h('h1', null, (data && data.client && data.client.brand) || 'GEO 工作台'),
      h('p', { className: 'gd-sub' }, data && data.client
        ? `${data.client.city} · ${data.client.category} · ${(data.prompts || []).length} 个问题 · 引擎 ${(data.engine && data.engine.name) || '—'}`
        : '加载中…')),
    h('div', { className: 'gd-head-actions' },
      h('button', { className: 'gd-btn gd-btn-primary', disabled: busy || running, onClick: startRun }, runLabel),
      h('a', {
        className: 'gd-btn', href: '/geo-desk/report.html', target: '_blank', rel: 'noreferrer',
      }, '看报告')));

  const nav = h('nav', { className: 'gd-tabs' }, GD_TABS.map(item => h('button', {
    key: item.id,
    className: item.id === tab ? 'gd-tab gd-tab-on' : 'gd-tab',
    onClick: () => setTab(item.id),
  }, item.label)));

  let body = h('p', { className: 'gd-muted' }, '加载中…');
  if (data) {
    if (tab === 'overview') body = h(GdOverview, { data, onRun: startRun, busy });
    else if (tab === 'prompts') body = h(GdPrompts, { data });
    else if (tab === 'monitor') body = h(GdMonitor, { data });
    else if (tab === 'insight') body = h(GdInsight, { data });
    else if (tab === 'action') body = h(GdAction, { data });
    else body = h(GdReport, { data, onExport: exportReport });
  }

  const content = h('div', { className: 'gd-root' },
    h('style', null, GD_CSS),
    header,
    nav,
    error ? h('div', { className: 'gd-alert' }, error) : null,
    notice ? h('div', { className: 'gd-alert gd-alert-ok' }, notice) : null,
    h('main', { className: 'gd-main' }, body));

  return h(GeoBoundary, null, content);
}

const GD_CSS = `
.gd-root { height:100%; min-height:100%; overflow:auto; box-sizing:border-box; padding:28px 32px 64px; max-width:1180px; margin:0 auto;
  color:var(--dsw-alias-label-primary,#1b1a17); font-family:inherit; }
.gd-crash { margin:24px; padding:14px 16px; border:1px solid #B4593A; background:#FBE6DE; border-radius:8px;
  font-size:12.5px; color:#7A2E14; }
.gd-crash pre { white-space:pre-wrap; word-break:break-all; font-size:11px; margin:8px 0 0; max-height:240px; overflow:auto; }
.gd-head { display:flex; justify-content:space-between; align-items:flex-end; gap:16px; padding-bottom:16px;
  border-bottom:1px solid var(--dsw-alias-border-l2,#ddd6c8); }
.gd-kicker { font-size:10.5px; letter-spacing:.22em; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-head h1 { font-size:26px; margin:8px 0 4px; letter-spacing:.01em; }
.gd-sub { margin:0; font-size:12.5px; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-head-actions { display:flex; gap:8px; }
.gd-tabs { display:flex; gap:4px; margin:18px 0 20px; }
.gd-tab { background:transparent; border:0; padding:7px 14px; border-radius:6px; cursor:pointer; font-size:13px;
  color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-tab:hover { background:var(--dsw-alias-bg-layer-2,#f2eee5); }
.gd-tab-on { background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#1b1a17);
  box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,#ddd6c8); font-weight:600; }
.gd-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:7px 14px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l2,#ddd6c8); background:var(--dsw-alias-bg-layer-1,#fff); cursor:pointer;
  font-size:13px; color:inherit; text-decoration:none; }
.gd-btn:hover { border-color:var(--dsw-alias-brand-primary,#0F5C4B); }
.gd-btn:disabled { opacity:.55; cursor:default; }
.gd-btn-primary { background:var(--dsw-alias-brand-primary,#0F5C4B); border-color:transparent; color:#fff; }
.gd-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.gd-card { border:1px solid var(--dsw-alias-border-l2,#ddd6c8); border-radius:8px; padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1,#fff); }
.gd-card-label { font-size:11.5px; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-card-value { font-size:26px; font-weight:700; margin-top:2px; font-variant-numeric:tabular-nums; }
.gd-unit { font-size:13px; font-weight:400; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-card-note { font-size:11px; color:var(--dsw-alias-label-secondary,#6b6459); margin-top:3px; }
.gd-section { margin-top:26px; }
.gd-section-head { display:flex; align-items:baseline; gap:10px; margin-bottom:8px; }
.gd-section-head h3 { font-size:14px; margin:0; }
.gd-hint { font-size:11.5px; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-table { width:100%; border-collapse:collapse; font-size:13px; }
.gd-table th { text-align:left; font-size:11px; letter-spacing:.06em; color:var(--dsw-alias-label-secondary,#6b6459);
  padding:6px 8px; border-bottom:1px solid var(--dsw-alias-border-l2,#ddd6c8); font-weight:600; }
.gd-table td { padding:7px 8px; border-bottom:1px solid var(--dsw-alias-border-l1,#ece6d9); vertical-align:top; }
.gd-table-tight td { padding:6px 8px; }
.gd-num { text-align:right; font-variant-numeric:tabular-nums; }
.gd-mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; }
.gd-muted { color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-strong { font-weight:700; }
.gd-good { color:var(--dsw-alias-state-success-primary,#0F5C4B); font-weight:700; }
.gd-bad { color:var(--dsw-alias-state-error-primary,#B4593A); font-weight:700; }
.gd-two { display:grid; grid-template-columns:1fr 1fr; gap:26px; margin-top:26px; }
.gd-rows { display:flex; flex-direction:column; gap:5px; }
.gd-row { display:grid; grid-template-columns:120px 1fr 36px; align-items:center; gap:10px; font-size:12.5px; }
.gd-row-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gd-domain { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; }
.gd-row-num { text-align:right; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-bar { height:8px; background:var(--dsw-alias-bg-layer-2,#efeadf); border-radius:2px; overflow:hidden; }
.gd-bar span { display:block; height:100%; background:var(--dsw-alias-brand-primary,#0F5C4B); }
.gd-bar .gd-fill-clay { background:#B4593A; }
.gd-bar .gd-fill-olive { background:#7A8B6F; }
.gd-gaps { display:grid; gap:10px; }
.gd-gap { border:1px solid var(--dsw-alias-border-l2,#ddd6c8); border-radius:8px; padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1,#fff); }
.gd-gap-title { font-size:13.5px; font-weight:600; }
.gd-gap-detail { font-size:12.5px; color:var(--dsw-alias-label-secondary,#6b6459); margin:5px 0; }
.gd-gap-items { margin:6px 0; padding-left:16px; font-size:12.5px; }
.gd-gap-items li { margin:2px 0; }
.gd-gap-action { font-size:12.5px; color:var(--dsw-alias-brand-primary,#0F5C4B); font-weight:600; margin:6px 0 0; }
.gd-filters { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px; }
.gd-chip { border:1px solid var(--dsw-alias-border-l2,#ddd6c8); background:transparent; border-radius:999px;
  padding:4px 12px; font-size:12px; cursor:pointer; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-chip-on { background:var(--dsw-alias-bg-layer-1,#fff); color:var(--dsw-alias-label-primary,#1b1a17);
  border-color:var(--dsw-alias-brand-primary,#0F5C4B); font-weight:600; }
.gd-runline { display:flex; align-items:center; gap:12px; font-size:12.5px; }
.gd-status { font-family:ui-monospace,monospace; font-size:11px; padding:2px 8px; border-radius:4px;
  background:var(--dsw-alias-bg-layer-2,#efeadf); }
.gd-status-running { background:#FDF2D8; color:#8A5A00; }
.gd-status-done { background:#E4F0E6; color:#0F5C4B; }
.gd-status-failed { background:#FBE6DE; color:#B4593A; }
.gd-progress { height:6px; background:var(--dsw-alias-bg-layer-2,#efeadf); border-radius:3px; overflow:hidden; margin:10px 0 6px; }
.gd-progress span { display:block; height:100%; background:var(--dsw-alias-brand-primary,#0F5C4B); transition:width .3s; }
.gd-answers { display:flex; flex-direction:column; gap:8px; }
.gd-answer { border:1px solid var(--dsw-alias-border-l1,#ece6d9); border-radius:6px; padding:9px 12px; }
.gd-answer-head { display:flex; align-items:center; gap:8px; font-size:12.5px; }
.gd-answer-q { font-weight:600; }
.gd-answer-text { margin:5px 0 0; font-size:12px; color:var(--dsw-alias-label-secondary,#6b6459); line-height:1.55; }
.gd-dot { width:7px; height:7px; border-radius:50%; background:#C9C0AE; flex:none; }
.gd-dot-on { background:#2E8B57; }
.gd-badge { font-size:10.5px; padding:1px 7px; border-radius:999px; background:var(--dsw-alias-bg-layer-2,#efeadf);
  color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-badge-warn { background:#FBE6DE; color:#B4593A; }
.gd-alert { border-left:3px solid var(--dsw-alias-state-error-primary,#B4593A); background:#FBE6DE;
  padding:8px 12px; font-size:12.5px; margin-bottom:12px; }
.gd-alert-ok { border-left-color:var(--dsw-alias-brand-primary,#0F5C4B); background:#E4F0E6; }
.gd-empty { border:1px dashed var(--dsw-alias-border-l2,#ddd6c8); border-radius:10px; padding:28px; text-align:center; }
.gd-empty-title { font-size:16px; font-weight:600; margin-bottom:6px; }
.gd-list { margin:6px 0; padding-left:18px; font-size:12.5px; color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-list li { margin:3px 0; }
.gd-actions { display:flex; gap:8px; margin-top:10px; }
.gd-small { font-size:11.5px; }
.gd-focus { border:1px solid var(--dsw-alias-border-l2,#ddd6c8); border-radius:8px; padding:12px 16px; margin-bottom:16px;
  background:var(--dsw-alias-bg-layer-1,#fff); }
.gd-focus-title { font-size:11px; letter-spacing:.14em; color:var(--dsw-alias-label-secondary,#6b6459); margin-bottom:4px; }
.gd-action { border:1px solid var(--dsw-alias-border-l2,#ddd6c8); border-radius:8px; padding:12px 14px; margin-bottom:10px;
  background:var(--dsw-alias-bg-layer-1,#fff); }
.gd-action-head { display:flex; align-items:center; gap:10px; font-size:13.5px; }
.gd-prio { font-size:10.5px; padding:1px 7px; border-radius:3px; background:var(--dsw-alias-label-primary,#1b1a17); color:#fff; }
.gd-prio-p0 { background:#B4593A; }
.gd-brief { border-top:1px dashed var(--dsw-alias-border-l2,#ddd6c8); margin-top:8px; padding-top:8px; font-size:12px;
  color:var(--dsw-alias-label-secondary,#6b6459); }
.gd-brief-line { margin:3px 0; }
.gd-brief-line b { color:var(--dsw-alias-label-primary,#1b1a17); margin-right:8px; font-weight:600; }
@media (max-width: 900px) { .gd-grid { grid-template-columns:repeat(2,1fr); } .gd-two { grid-template-columns:1fr; } }
`;

function GeoIcon(props) {
  const size = props.size || 20;
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: props.active ? 2 : 1.6,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  },
  h('circle', { cx: 10.5, cy: 10.5, r: 6 }),
  h('path', { d: 'M15 15l5 5' }),
  h('path', { d: 'M8 10.5h5M10.5 8v5' }));
}

// ---- src/main.js ----
/* ============================================================
 * src/main.js — GEO Desk：客户端注册
 * 与 panel.js 共用一个工厂作用域（React、h 由外层提供），无 import/export。
 * ============================================================ */

const inject = ['slots'];

/**
 * 注册整页面板与侧栏入口。
 * @param {object} ctx 客户端根上下文
 * @returns {void}
 */
function panelApply(ctx) {
  ctx.slots.inject('main', function () {
    return ctx.slots.register(
      { name: 'main', key: 'geo-desk' },
      GeoPanel
    );
  });
  ctx.effect(function () {
    return ctx.slots.inject('sidebar.panellist', function () {
      return ctx.slots.register(
        {
          name: 'sidebar.panellist',
          id: 'geo-desk',
          order: 8,
          label: function () { return 'GEO 工作台'; },
        },
        GeoIcon
      );
    });
  }, 'geo-desk: sidebar entry');
}

    return { inject, apply: panelApply }
  },
})
