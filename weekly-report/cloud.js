// weekly-report/cloud.js
// 通过微信官方「云开发 HTTP API」从小程序云环境拉取打卡数据（等同服务端查询，可绕过客户端 20 条限制）
//
// 配置方式二选一：
//   1. 环境变量: WX_APPID, WX_APPSECRET, WX_ENV
//   2. 文件 weekly-report/cloud-config.json: { "appid": "wx...", "secret": "...", "env": "cloud1-..." }
//
// 参考:
//   access_token   https://api.weixin.qq.com/cgi-bin/token
//   databaseQuery  https://api.weixin.qq.com/tcb/databasequery

const fs = require('fs');
const path = require('path');

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/token';
const QUERY_URL = 'https://api.weixin.qq.com/tcb/databasequery';
const PAGE_SIZE = 100;

const DAY_MS = 86400000;
const dayIndex = dateStr => Math.round((new Date(dateStr + 'T00:00:00') - new Date('1970-01-01T00:00:00')) / DAY_MS);
const fmtDate = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 读取配置（环境变量优先，其次 cloud-config.json）
function loadConfig() {
  const env = process.env.WX_ENV;
  const appid = process.env.WX_APPID;
  const secret = process.env.WX_APPSECRET;
  if (env && appid && secret) return { env, appid, secret };
  const file = path.join(__dirname, 'cloud-config.json');
  if (fs.existsSync(file)) {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cfg.env && cfg.appid && cfg.secret) return cfg;
  }
  return null;
}

function hasConfig() {
  return !!loadConfig();
}

async function getAccessToken(appid, secret) {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`获取 access_token 失败（请检查 appid/secret 是否正确）: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function queryDb(env, token, query) {
  const url = `${QUERY_URL}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ env, query }),
  });
  const json = await res.json();
  if (json.errcode && json.errcode !== 0) {
    const err = new Error(`云数据库查询失败(${json.errcode}): ${json.errmsg}`);
    err.code = json.errcode;
    throw err;
  }
  return json;
}

// 分页拉取一个集合（where 可选，如 `{dateStr: _.gte("2026-08-01")}`）
async function fetchCollection(env, token, collection, whereStr, orderBy) {
  const all = [];
  let skip = 0;
  while (true) {
    let query = `db.collection("${collection}")`;
    if (whereStr) query += `where(${whereStr})`;
    if (orderBy) query += `orderBy(${orderBy})`;
    query += `.skip(${skip}).limit(${PAGE_SIZE}).get()`;
    const json = await queryDb(env, token, query);
    const records = (json.data || []).map(s => JSON.parse(s));
    all.push(...records);
    const total = json.pager ? json.pager.Total : 0;
    if (skip + records.length >= total) break;
    skip += records.length;
  }
  return all;
}

// 拉取某周及之前共 9 周的打卡数据，并与 users 集合联表补上昵称
async function fetchWeek(monday, sunday) {
  const config = loadConfig();
  if (!config) {
    throw new Error('未找到云配置：请设置 WX_APPID/WX_APPSECRET/WX_ENV 环境变量，或创建 cloud-config.json（见 cloud-config.example.json）');
  }

  console.log(`云配置: env=${config.env} appid=${config.appid}`);
  const token = await getAccessToken(config.appid, config.secret);

  // 向前多拉 8 周，便于脚本自动回溯最近有数据的周
  const windowStart = fmtDate(new Date(dayIndex(monday) * DAY_MS - 56 * DAY_MS + DAY_MS / 2));
  const windowEnd = sunday;
  const whereStr = `{dateStr: _.gte("${windowStart}").and(_.lte("${windowEnd}"))}`;

  let checkins;
  try {
    checkins = await fetchCollection(config.env, token, 'checkins', whereStr, '"timestamp","asc"');
  } catch (err) {
    // 若范围查询语法不被支持，退化为全量分页 + 本地过滤
    console.warn('范围查询失败，改用全量拉取:', err.message);
    checkins = (await fetchCollection(config.env, token, 'checkins')).filter(r => {
      const i = dayIndex(r.dateStr || fmtDate(new Date(r.timestamp)));
      return i >= dayIndex(windowStart) && i <= dayIndex(windowEnd);
    });
  }

  // 联表 users 集合，补昵称（打卡记录只存 userId）
  let users = [];
  try {
    users = await fetchCollection(config.env, token, 'users');
  } catch (err) {
    console.warn('拉取 users 集合失败，昵称将显示为匿名:', err.message);
  }

  const userMap = {};
  users.forEach(u => { userMap[u.userId || u._openid || u._id] = u; });

  return checkins.map(r => {
    const uid = r.userId || r._openid || r._id;
    const u = userMap[uid] || {};
    return {
      ...r,
      userId: uid,
      nickName: u.nickName || r.nickName || '',
      avatarUrl: u.avatarUrl || r.avatarUrl || '',
    };
  });
}

module.exports = { fetchWeek, hasConfig };
