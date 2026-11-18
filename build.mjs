// 把 src/panel.js + src/main.js 拼成浏览器侧的 client.js。
// 两个源文件共用一个工厂作用域：React 由浏览器模块表提供，其余都是局部函数。
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const order = ['panel.js', 'main.js']

const parts = []
for (const name of order) {
  const source = await readFile(join(here, 'src', name), 'utf8')
  parts.push(`// ---- src/${name} ----\n${source.trim()}\n`)
}

const bundle = `window.__ModuleLoader__.load({
  id: 'dsh-geo-desk',
  factory(require) {
    const React = require('react')
    const h = React.createElement
${parts.join('\n')}
    return { inject, apply: panelApply }
  },
})
`

try {
  new Function(bundle)
} catch (error) {
  console.error('client bundle syntax error:', error.message)
  process.exit(1)
}

await writeFile(join(here, 'client.js'), bundle)
console.log(`client.js written: ${Buffer.byteLength(bundle)} bytes`)
