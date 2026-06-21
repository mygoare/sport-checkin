// app.js
App({
  globalData: {
    userInfo: null,
    cloudReady: false,
    usersCache: {},
    // { [openid]: { userId, nickName, avatarUrl } }
    config: {},
  },

  onLaunch() {
    wx.cloud.init({
      env: 'YOUR_CLOUD_ENV_ID',   // ← 改成你自己的环境 ID
      traceUser: false,
    });
    this.globalData.cloudReady = true;
  },

  db() {
    return wx.cloud.database();
  },

  getTodayStr() {
    return this.formatDate(new Date());
  },

  formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // ── 远程配置 ──────────────────────────────

  async fetchConfig() {
    try {
      const res = await this.db().collection('config').get();
      const config = {};
      res.data.forEach(item => { config[item.key] = item.value; });
      this.globalData.config = config;
    } catch (err) {
      console.error('读取配置失败', err);
    }
  },

  // 读取某个配置项，取不到时返回 defaultValue
  getConfig(key, defaultValue = true) {
    const config = this.globalData.config || {};
    return key in config ? config[key] : defaultValue;
  },

  // ── 用户相关 ──────────────────────────────

  // 保存或更新用户信息（头像 base64 + 昵称）
  async saveUser(userInfo) {
    const db = this.db();
    const existing = await db.collection('users')
      .where({ userId: userInfo.userId })
      .count();
    if (existing.total > 0) {
      await db.collection('users')
        .where({ userId: userInfo.userId })
        .update({ data: { nickName: userInfo.nickName, avatarUrl: userInfo.avatarUrl } });
    } else {
      await db.collection('users').add({ data: userInfo });
    }
    // 同步到内存缓存
    this.globalData.usersCache[userInfo.userId] = userInfo;
  },

  // 一次性拉取所有用户，缓存到内存
  async fetchAllUsers() {
    const res = await this.db().collection('users').get();
    const cache = {};
    res.data.forEach(u => { cache[u.userId] = u; });
    this.globalData.usersCache = cache;
    return cache;
  },

  // 从缓存获取用户信息（同步）
  getUserFromCache(userId) {
    return this.globalData.usersCache[userId] || { nickName: '未知用户', avatarUrl: '' };
  },

  // ── 打卡相关 ──────────────────────────────

  // 添加打卡记录（只存 userId，不存头像昵称）
  async addCheckin(userId, content) {
    const record = {
      userId,
      content,
      dateStr: this.getTodayStr(),
      time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      timestamp: Date.now(),
    };
    await this.db().collection('checkins').add({ data: record });
    return record;
  },

  // 查询某天的打卡记录
  async getCheckinsByDate(dateStr) {
    const res = await this.db().collection('checkins')
      .where({ dateStr })
      .orderBy('timestamp', 'asc')
      .get();
    return res.data;
  },

  // 查询某月的所有打卡记录
  // 每次只能查询20条，不知是不是 微信云开发的限制！！！
  async getCheckinsByMonth(year, month) {
    const mm = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const end = `${year}-${mm}-31`;
    const db = this.db();
    
    let allRecords = [];
    let skip = 0;
    const pageSize = 20;
    
    while (true) {
      const res = await db.collection('checkins')
        .where({ dateStr: db.command.gte(start).and(db.command.lte(end)) })
        .limit(pageSize)
        .skip(skip)
        .get();
      
      allRecords = allRecords.concat(res.data);
      
      if (res.data.length < pageSize) break;  // 没有更多数据了
      skip += pageSize;
    }
    
    return allRecords.sort((a, b) => a.timestamp - b.timestamp);
  },
});
