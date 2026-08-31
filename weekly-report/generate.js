#!/usr/bin/env node
/**
 * 运动打卡周报图片生成脚本
 *
 * 用法:
 *   node generate.js                                  # 使用默认配置
 *   node generate.js --source cloud                   # 直接从小程序云环境拉取数据（无需手动导出）
 *   node generate.js --source file --input data/checkins.json   # 读取导出的数据文件
 *   node generate.js --output output/周报.png          # 指定输出文件
 *   node generate.js --date 2026-08-31                # 指定周报所在周的任意一天
 *   node generate.js --title "XX跑团周报"              # 自定义标题
 *
 * 数据来源:
 *   1. cloud  通过微信云开发 HTTP API 直接查询 checkins + users 集合（参照 pages/history 的查询方式，
 *             但走服务端接口，无客户端 20 条限制）。需配置 WX_APPID/WX_APPSECRET/WX_ENV 或 cloud-config.json。
 *   2. file   读取从云开发控制台导出的 JSON 文件（默认）。
 *   未指定 --source 时，若存在云配置则用 cloud，否则用 file。
 *
 * 文件数据格式说明:
 *   支持: 数组 / { "data": [...] } / 每行一个对象的 NDJSON。
 *   每条记录字段: userId(或 _openid), nickName, content, dateStr, time, timestamp
 */

const cloud = require('./cloud');

const fs = require('fs');
const path = require('path');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESCAPES[c]);

// ---------- 命令行参数 ----------
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ---------- 工具函数 ----------
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayIndex(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date('1970-01-01T00:00:00')) / 86400000);
}

// 一个自然周（周一到周日）的范围
function weekRange(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay(); // 0=周日
  const toMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + toMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday: fmtDate(monday), sunday: fmtDate(sunday) };
}

// 最长连续天数（本周内）
function longestRun(dateStrs) {
  const idxs = [...new Set(dateStrs.map(dayIndex))].sort((a, b) => a - b);
  let best = 0, cur = 0, prev = null;
  for (const i of idxs) {
    cur = prev !== null && i === prev + 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = i;
  }
  return best;
}

// ---------- 数据加载 ----------
function loadRecords(file) {
  const raw = fs.readFileSync(file, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
  }
  if (!Array.isArray(data)) {
    if (Array.isArray(data.data)) data = data.data;
    else if (Array.isArray(data.records)) data = data.records;
    else throw new Error(`无法识别的数据格式: ${file}`);
  }
  return data.map(normalize).filter(r => r.dateStr);
}

function normalize(r) {
  let dateStr = r.dateStr;
  if (!dateStr && r.timestamp) {
    const t = r.timestamp < 1e12 ? r.timestamp * 1000 : r.timestamp;
    dateStr = fmtDate(new Date(t));
  }
  return {
    userId: r.userId || r._openid || r._id,
    nickName: (r.nickName || r.name || '').trim() || '匿名',
    avatarUrl: r.avatarUrl || '',
    content: r.content || '',
    dateStr,
    time: r.time || '',
    timestamp: r.timestamp || 0,
  };
}

// ---------- 统计 ----------
function computeStats(records, monday, sunday) {
  const s = dayIndex(monday), e = dayIndex(sunday);
  const weekRecords = records.filter(r => {
    const i = dayIndex(r.dateStr);
    return i >= s && i <= e;
  });

  // 每日打卡人数（去重用户）
  const dailyUsers = {};
  const userMap = {};
  for (const r of weekRecords) {
    if (!userMap[r.userId]) {
      userMap[r.userId] = { userId: r.userId, nickName: r.nickName, avatarUrl: r.avatarUrl || '', dates: new Set() };
    }
    userMap[r.userId].dates.add(r.dateStr);
  }
  for (let i = s; i <= e; i++) {
    dailyUsers[i] = 0;
  }
  for (const r of weekRecords) {
    const i = dayIndex(r.dateStr);
    if (i >= s && i <= e) dailyUsers[i]++;
  }

  // 用户排行
  const ranking = Object.values(userMap)
    .map(u => {
      const dates = [...u.dates];
      return {
        userId: u.userId,
        nickName: u.nickName,
        avatarUrl: u.avatarUrl,
        count: dates.length,
        streak: longestRun(dates),
      };
    })
    .sort((a, b) => b.count - a.count || b.streak - a.streak || a.nickName.localeCompare(b.nickName, 'zh'));

  const totalCheckins = weekRecords.length;
  const peakDay = [...Array(7)].map((_, i) => s + i)
    .reduce((best, i) => (dailyUsers[i] > dailyUsers[best] ? i : best), s);

  return { weekRecords, dailyUsers, ranking, totalCheckins, peakDay };
}

// ---------- SVG 生成 ----------
function buildSvg(stats, monday, sunday, dateStr, title, dataSourceLabel, avatarMap = {}) {
  const W = 1080;
  const PAD = 48;
  const CW = W - PAD * 2; // 内容宽 984
  const HEADER_H = 200;
  const rows = [];
  let y = HEADER_H;

  // 头部
  rows.push(`<rect width="${W}" height="${HEADER_H}" fill="url(#headerGrad)"/>`);
  rows.push(`<text x="${W / 2}" y="${86}" text-anchor="middle" font-size="52" font-weight="bold" fill="#fff">${esc(title)}</text>`);
  rows.push(`<text x="${W / 2}" y="${146}" text-anchor="middle" font-size="30" fill="rgba(255,255,255,0.85)">${esc(monday)} ~ ${esc(sunday)}</text>`);

  // 概览卡片
  const peaks = stats.dailyUsers;
  const maxDayCount = peaks[stats.peakDay];
  const cards = [
    { value: stats.totalCheckins, label: '本周打卡次数' },
    { value: stats.ranking.length, label: '本周参与人数' },
    { value: maxDayCount, label: '单日最多打卡' },
  ];
  const cardGap = 20;
  const cardW = (CW - cardGap * 2) / 3;
  y += 30;
  cards.forEach((c, i) => {
    const cx = PAD + i * (cardW + cardGap);
    rows.push(`<rect x="${cx}" y="${y}" width="${cardW}" height="${132}" rx="20" fill="#fff" stroke="#E7EEEC"/>`);
    rows.push(`<text x="${cx + cardW / 2}" y="${y + 66}" text-anchor="middle" font-size="44" font-weight="bold" fill="#0FA98C">${c.value}</text>`);
    rows.push(`<text x="${cx + cardW / 2}" y="${y + 104}" text-anchor="middle" font-size="24" fill="#8A9AA8">${esc(c.label)}</text>`);
  });
  y += 132 + 30;

  // 卡片 1: 每日打卡人数（柱状图）
  const chartTop = y + 80;
  const chartH = 230;
  const baseline = chartTop + chartH;
  const barW = 54;
  const chartW = CW - 80;
  const chartLeft = PAD + 40;
  const gap = (chartW - barW * 7) / 8;
  const maxCount = Math.max(1, ...Object.values(peaks));

  rows.push(`<rect x="${PAD}" y="${y}" width="${CW}" height="${chartH + 220}" rx="24" fill="#fff" stroke="#E7EEEC"/>`);
  rows.push(`<text x="${PAD + 40}" y="${y + 44}" font-size="34" font-weight="bold" fill="#1F2D3D">每日打卡人数</text>`);
  rows.push(`<line x1="${chartLeft}" y1="${baseline}" x2="${chartLeft + chartW}" y2="${baseline}" stroke="#E7EEEC" stroke-width="2"/>`);

  // 基线 + 网格
  for (let i = 1; i <= 4; i++) {
    const gy = baseline - (chartH * i) / 4;
    rows.push(`<line x1="${chartLeft}" y1="${gy}" x2="${chartLeft + chartW}" y2="${gy}" stroke="#F0F4F2" stroke-width="1"/>`);
    rows.push(`<text x="${chartLeft - 12}" y="${gy + 9}" text-anchor="end" font-size="20" fill="#B8C4CE">${i}</text>`);
  }

  // 周一到周日
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const cur = new Date(monday + 'T00:00:00');
  for (let i = 0; i < 7; i++) {
    const ds = fmtDate(cur);
    const cnt = peaks[dayIndex(ds)] || 0;
    const isMax = dayIndex(ds) === stats.peakDay;
    const x = chartLeft + gap + i * (barW + gap);
    const bh = cnt > 0 ? Math.max(10, (cnt / maxCount) * chartH) : 0;
    const bx = x + (barW - Math.max(12, bh > 0 ? 54 : 0)) / 2;

    if (cnt > 0) {
      rows.push(`<rect x="${x}" y="${baseline - bh}" width="${barW}" height="${bh}" rx="14" fill="${isMax ? 'url(#barMaxGrad)' : 'url(#barGrad)'}"/>`);
    } else {
      rows.push(`<rect x="${x}" y="${baseline - 8}" width="${barW}" height="8" rx="4" fill="#E9EEEC"/>`);
    }
    rows.push(`<text x="${x + barW / 2}" y="${baseline - bh - 16}" text-anchor="middle" font-size="26" font-weight="bold" fill="${cnt > 0 ? (isMax ? '#E67E22' : '#0FA98C') : '#B8C4CE'}">${cnt}</text>`);
    rows.push(`<text x="${x + barW / 2}" y="${baseline + 36}" text-anchor="middle" font-size="26" fill="#33475B">${weekdays[i]}</text>`);
    rows.push(`<text x="${x + barW / 2}" y="${baseline + 68}" text-anchor="middle" font-size="22" fill="#9AA9B6">${ds.slice(5)}</text>`);
    cur.setDate(cur.getDate() + 1);
  }
  y += chartH + 220;

  // 卡片 2: 打卡排行
  const RANK_CAP = 12;
  const shown = stats.ranking.slice(0, RANK_CAP);
  const rowH = 84, rowGap = 14;
  const rankCardH = 90 + shown.length * (rowH + rowGap) + 20;
  const rowX = PAD + 40;
  const rowW = CW - 80;
  const medal = ['#F1C40F', '#BDC3C7', '#D35400'];

  rows.push(`<rect x="${PAD}" y="${y}" width="${CW}" height="${rankCardH}" rx="24" fill="#fff" stroke="#E7EEEC"/>`);
  rows.push(`<text x="${PAD + 40}" y="${y + 44}" font-size="34" font-weight="bold" fill="#1F2D3D">打卡排行（${stats.ranking.length} 人参与）</text>`);

  let ry = y + 70;
  shown.forEach((u, i) => {
    const bg = i % 2 === 0 ? '#F7FAF9' : '#FFFFFF';
    rows.push(`<rect x="${rowX}" y="${ry}" width="${rowW}" height="${rowH}" rx="16" fill="${bg}"/>`);
    // 头像
    const cx = rowX + 42, cy = ry + rowH / 2, r = 32;
    const av = avatarMap[u.userId];
    if (av) {
      rows.push(`<clipPath id="cp${i}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
      rows.push(`<g clip-path="url(#cp${i})"><image x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" xlink:href="${av}"/></g>`);
    } else {
      rows.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#DCE9E6"/>`);
      rows.push(`<text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="28" font-weight="bold" fill="#4A7A6E">${esc((u.nickName || '?').slice(0, 1))}</text>`);
    }
    // 排名徽章
    const badgeFill = i < 3 ? medal[i] : '#C7D2CE';
    const bx = cx + r - 6, by = cy + r - 6;
    rows.push(`<circle cx="${bx}" cy="${by}" r="15" fill="${badgeFill}" stroke="#fff" stroke-width="3"/>`);
    rows.push(`<text x="${bx}" y="${by + 7}" text-anchor="middle" font-size="19" font-weight="bold" fill="#fff">${i + 1}</text>`);
    // 昵称
    rows.push(`<text x="${rowX + 96}" y="${ry + 34}" font-size="30" font-weight="bold" fill="#1F2D3D">${esc(u.nickName)}</text>`);
    // 连续打卡
    const streakColor = u.streak > 0 ? '#E67E22' : '#B8C4CE';
    rows.push(`<text x="${rowX + 96}" y="${ry + 64}" font-size="24" fill="${streakColor}">${u.streak > 0 ? `连续打卡 ${u.streak} 天` : '—'}</text>`);
    // 次数
    rows.push(`<text x="${rowX + rowW - 40}" y="${cy + 11}" text-anchor="end" font-size="32" font-weight="bold" fill="#0FA98C">${u.count} 次</text>`);
    ry += rowH + rowGap;
  });
  if (stats.ranking.length > RANK_CAP) {
    rows.push(`<text x="${rowX}" y="${ry + 10}" font-size="24" fill="#9AA9B6">… 另有 ${stats.ranking.length - RANK_CAP} 位成员参与</text>`);
    ry += 44;
  }
  y += rankCardH;

  // 页脚
  rows.push(`<text x="${W / 2}" y="${y + 70}" text-anchor="middle" font-size="24" fill="#9AA9B6">生成于 ${esc(dateStr)} · 数据源：${esc(dataSourceLabel)}</text>`);

  const H = y + 110;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="headerGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0FA98C"/>
      <stop offset="1" stop-color="#2BD98A"/>
    </linearGradient>
    <linearGradient id="barGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#0FA98C"/>
      <stop offset="1" stop-color="#2BD98A"/>
    </linearGradient>
    <linearGradient id="barMaxGrad" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#E67E22"/>
      <stop offset="1" stop-color="#F6B73C"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#EEF3F1"/>
  ${rows.join('\n')}
</svg>`;
  return { svg, H };
}

// ---------- 主流程 ----------
async function main() {
  const args = parseArgs(process.argv);
  const input = args.input || path.join(__dirname, 'data', 'checkins.json');
  const outputArg = args.output;
  const dateStr = args.date || fmtDate(new Date());
  const title = args.title || '运动打卡许愿周报';
  const source = args.source || (cloud.hasConfig() ? 'cloud' : 'file');
  const dataSourceLabel = source === 'cloud' ? '云开发 HTTP API' : `导出文件 ${path.basename(input)}`;

  let records;
  if (source === 'cloud') {
    // 云端拉取（含 9 周数据窗口 + users 联表），后续按周本地筛选
    const { monday } = weekRange(dateStr);
    records = await cloud.fetchWeek(monday, fmtDate(new Date(new Date(monday + 'T00:00:00').getTime() + 6 * 86400000)));
    console.log(`☁️  已从云端拉取 ${records.length} 条打卡记录（近 9 周窗口）`);
  } else {
    records = loadRecords(input);
    console.log(`已读取 ${records.length} 条打卡记录`);
  }

  // 找到有数据的周（自动向前回溯最多 8 周）
  let { monday, sunday } = weekRange(dateStr);
  let stats = computeStats(records, monday, sunday);
  let weeksBack = 0;
  while (stats.weekRecords.length === 0 && weeksBack < 8) {
    const prev = new Date(monday + 'T00:00:00');
    prev.setDate(prev.getDate() - 7);
    ({ monday, sunday } = weekRange(fmtDate(prev)));
    stats = computeStats(records, monday, sunday);
    weeksBack++;
  }
  if (stats.weekRecords.length === 0) {
    console.error(`⚠️  未找到任何打卡记录，请检查${dataSourceLabel}或 --date 参数`);
    process.exit(1);
  }
  if (weeksBack > 0) {
    console.log(`本周(${weekRange(dateStr).monday}~)暂无数据，已自动使用上周（${monday}~${sunday}）`);
  }

  console.log(`周报范围: ${monday} ~ ${sunday}`);
  console.log(`本周打卡 ${stats.totalCheckins} 次，${stats.ranking.length} 人参与`);
  console.log(`打卡排行 Top3: ${stats.ranking.slice(0, 3).map(u => `${u.nickName}(${u.count}次/连${u.streak}天)`).join('、')}`);

  // 默认文件名: 20260824-20260830运动打卡许愿周报.png
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '');
  const output = outputArg || path.join(
    __dirname,
    'output',
    `${monday.replace(/-/g, '')}-${sunday.replace(/-/g, '')}${safeTitle}.png`
  );

  // 预处理头像：base64 缩小为 128px，避免 SVG 过大、保证渲染稳定
  const sharp = (await import('sharp')).default;
  const avatarMap = {};
  for (const u of stats.ranking) {
    const url = u.avatarUrl;
    if (!url || !url.startsWith('data:image')) continue;
    try {
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      const small = await sharp(buf).resize(128, 128, { fit: 'cover' }).png().toBuffer();
      avatarMap[u.userId] = 'data:image/png;base64,' + small.toString('base64');
    } catch (err) {
      console.warn(`⚠️  ${u.nickName} 的头像解析失败，使用文字头像:`, err.message);
    }
  }
  if (Object.keys(avatarMap).length > 0) console.log(`已处理 ${Object.keys(avatarMap).length} 个头像`);

  const { svg, H } = buildSvg(stats, monday, sunday, dateStr, title, dataSourceLabel, avatarMap);

  await sharp(Buffer.from(svg)).png().toFile(output);
  console.log(`✅ 周报图片已生成: ${output}（${1080}x${H}）`);
}

main().catch(err => {
  console.error('生成失败:', err.message);
  process.exit(1);
});
