/**
 * server.js — 本地静态服务器（零依赖，Node 原生 http）
 * 用途：
 *   1. 桌面预览：node server.js 后访问 http://localhost:8080
 *   2. 真机预览：手机与电脑连同一局域网，访问 http://<电脑IP>:8080
 * 用法：node server.js [端口]（默认 8080）
 */
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = __dirname
const PORT = Number(process.argv[2]) || 8080

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
}

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  const filePath = path.join(ROOT, urlPath)
  // 防目录穿越
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('404 Not Found: ' + urlPath)
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
}).listen(PORT, () => {
  const os = require('os')
  const nets = os.networkInterfaces()
  const ips = []
  Object.keys(nets).forEach(k => {
    nets[k].forEach(n => { if (n.family === 'IPv4' && !n.internal) ips.push(n.address) })
  })
  console.log('消毒供应运营管理系统 H5 已启动：')
  console.log('  本机访问：  http://localhost:' + PORT)
  ips.forEach(ip => console.log('  手机访问：  http://' + ip + ':' + PORT))
})
