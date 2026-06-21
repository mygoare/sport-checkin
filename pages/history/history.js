// pages/history/history.js
const app = getApp();

Page({
  data: {
    // 统计（全局，首次加载今月时计算）
    totalCheckins: 0,
    activeUsers: [],

    // 日历
    currentYear: 0,
    currentMonth: 0,
    currentMonthLabel: '',
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarDays: [],
    canNext: false,

    // 详情弹窗
    selectedDateLabel: '',
    selectedCheckins: [],
    showDetail: false,

    loading: false,

    showHistoryCalendar: true,
  },

  // 按月缓存，key 为 'YYYY-MM'
  _cache: {},

  onLoad() {
    this.setData({ showHistoryCalendar: getApp().getConfig('showHistoryCalendar') });
    const now = new Date();
    this.setData({
      currentYear: now.getFullYear(),
      currentMonth: now.getMonth() + 1,
    });
    this.loadMonth(now.getFullYear(), now.getMonth() + 1);
  },

  onShow() {
    const { currentYear, currentMonth } = this.data;
    // 刷新当前月（清除缓存，确保打卡后数据最新）
    const key = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    delete this._cache[key];
    this.loadMonth(currentYear, currentMonth);
  },

  async loadMonth(year, month) {
    const key = `${year}-${String(month).padStart(2, '0')}`;

    // 命中缓存直接渲染
    if (this._cache[key]) {
      this.buildCalendar(year, month, this._cache[key]);
      return;
    }

    this.setData({ loading: true });
    try {
      const records = await app.getCheckinsByMonth(year, month);
      // 从缓存拼接用户信息
      const enriched = records.map(r => ({ ...r, ...app.getUserFromCache(r.userId) }));
      this._cache[key] = enriched;
      this.buildCalendar(year, month, enriched);
    } catch (err) {
      console.error('加载月份失败', err);
      wx.showToast({ title: '加载失败，请重试', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  buildCalendar(year, month, records) {
    const todayStr = app.getTodayStr();
    const now = new Date();

    // 按日期分组
    const byDate = {};
    records.forEach(r => {
      if (!byDate[r.dateStr]) byDate[r.dateStr] = [];
      byDate[r.dateStr].push(r);
    });

    const currentMonthLabel = `${year}年${month}月`;
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    const calendarDays = [];

    // 前补空位
    for (let i = 0; i < firstDay; i++) {
      calendarDays.push({ empty: true });
    }

    // 当月每一天
    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(month).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;
      const checkins = byDate[dateStr] || [];

      const usersSeen = {};
      const users = [];
      checkins.forEach(r => {
        if (!usersSeen[r.userId]) {
          usersSeen[r.userId] = true;
          users.push({ userId: r.userId, avatarUrl: r.avatarUrl });
        }
      });

      const isFuture = dateStr > todayStr;

      calendarDays.push({
        empty: false,
        dateStr,
        dayNum: d,
        isToday: dateStr === todayStr,
        isFuture,
        hasCheckin: checkins.length > 0,
        users,
        checkins,
      });
    }

    const canNext = !(year === now.getFullYear() && month === now.getMonth() + 1);

    // 统计当月数据
    const usersMap = {};
    records.forEach(r => {
      if (!usersMap[r.userId]) {
        usersMap[r.userId] = { userId: r.userId, nickName: r.nickName, avatarUrl: r.avatarUrl };
      }
    });

    this.setData({
      currentYear: year,
      currentMonth: month,
      currentMonthLabel,
      calendarDays,
      canNext,
      totalCheckins: records.length,
      activeUsers: Object.values(usersMap),
      _byDate: byDate,
    });
  },

  onPrevMonth() {
    let { currentYear, currentMonth } = this.data;
    currentMonth--;
    if (currentMonth === 0) { currentMonth = 12; currentYear--; }
    this.loadMonth(currentYear, currentMonth);
  },

  onNextMonth() {
    if (!this.data.canNext) return;
    let { currentYear, currentMonth } = this.data;
    currentMonth++;
    if (currentMonth === 13) { currentMonth = 1; currentYear++; }
    this.loadMonth(currentYear, currentMonth);
  },

  onDayTap(e) {
    const { dateStr, hasCheckin } = e.currentTarget.dataset;
    if (!hasCheckin) return;
    const key = `${this.data.currentYear}-${String(this.data.currentMonth).padStart(2, '0')}`;
    const records = this._cache[key] || [];
    const checkins = records.filter(r => r.dateStr === dateStr);
    const date = new Date(dateStr + 'T00:00:00');
    const label = `${date.getMonth() + 1}月${date.getDate()}日`;
    this.setData({
      selectedDateLabel: label,
      selectedCheckins: checkins,
      showDetail: true,
    });
  },

  onCloseDetail() {
    this.setData({ showDetail: false });
  },
});
