// pages/index/index.js
const app = getApp();

Page({
  data: {
    userInfo: null,
    hasLogin: false,
    todayStr: '',
    todayDisplay: '',
    todayCheckins: [],
    todayUniqueCount: 0,
    hasCheckedIn: false,
    loading: false,
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    tempAvatarUrl: '',
    tempNickName: '',
    showSetup: false,
  },

  onLoad() {
    this.initDate();
    this.loadUserInfo();
  },

  onShow() {
    if (getApp().globalData.usersCache && Object.keys(getApp().globalData.usersCache).length > 0) {
      this.refreshCheckins();
    }
  },

  initDate() {
    const now = new Date();
    const todayStr = app.getTodayStr();
    const weekDay = this.data.weekDays[now.getDay()];
    const month = now.getMonth() + 1;
    const day = now.getDate();
    this.setData({ todayStr, todayDisplay: `${month}月${day}日 周${weekDay}` });
  },

  onJoinTap() {
    this.setData({ showSetup: true });
    wx.pageScrollTo({ selector: '.setup-card', duration: 300 });
  },

  async loadUserInfo() {
    const cached = wx.getStorageSync('userInfo');
    if (cached && cached.userId) {
      if (cached.userId.startsWith('user_')) {
        await this.upgradeToOpenId(cached);
      } else {
        this.setData({ userInfo: cached, hasLogin: true });
      }
    } else {
      await this.fetchAndCacheOpenId();
    }
    // 启动时并行拉取用户缓存和远程配置
    await Promise.all([app.fetchAllUsers(), app.fetchConfig()]);
    this.refreshCheckins();
  },

  async fetchAndCacheOpenId() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = res.result.openid;
      if (openid) wx.setStorageSync('openid', openid);
    } catch (err) {
      console.error('获取 openid 失败', err);
    }
  },

  async upgradeToOpenId(oldUserInfo) {
    try {
      const res = await wx.cloud.callFunction({ name: 'getOpenId' });
      const openid = res.result.openid;
      if (!openid) return;
      const newUserInfo = { ...oldUserInfo, userId: openid };
      wx.setStorageSync('userInfo', newUserInfo);
      wx.setStorageSync('openid', openid);
      this.setData({ userInfo: newUserInfo, hasLogin: true });
    } catch (err) {
      this.setData({ userInfo: oldUserInfo, hasLogin: true });
    }
  },

  async refreshCheckins() {
    const { userInfo, todayStr } = this.data;
    this.setData({ loading: true });
    try {
      const checkins = await app.getCheckinsByDate(todayStr);
      // 从缓存拼接用户信息
      const enriched = checkins.map(r => ({
        ...r,
        ...app.getUserFromCache(r.userId),
      }));
      let hasCheckedIn = false;
      if (userInfo) {
        hasCheckedIn = enriched.some(r => r.userId === userInfo.userId);
      }
      const uniqueCount = new Set(enriched.map(r => r.userId)).size;
      this.setData({ todayCheckins: enriched, hasCheckedIn, todayUniqueCount: uniqueCount });
    } catch (err) {
      console.error('刷新打卡失败', err);
    } finally {
      this.setData({ loading: false });
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    wx.showLoading({ title: '处理头像中...' });
    const fs = wx.getFileSystemManager();
    fs.readFile({
      filePath: avatarUrl,
      encoding: 'base64',
      success: (r) => {
        const base64 = 'data:image/jpeg;base64,' + r.data;
        this.setData({ tempAvatarUrl: base64 });
        wx.hideLoading();
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '头像处理失败，请重试', icon: 'none' });
      }
    });
  },

  onNickNameInput(e) {
    this.setData({ tempNickName: e.detail.value });
  },

  onNickNameBlur(e) {
    this.setData({ tempNickName: e.detail.value });
  },

  async onSaveProfile() {
    const { tempAvatarUrl, tempNickName } = this.data;
    if (!tempNickName.trim()) {
      wx.showToast({ title: '请填写昵称', icon: 'none' });
      return;
    }
    if (!tempAvatarUrl) {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '设置中...' });
    try {
      let userId = wx.getStorageSync('openid');
      if (!userId) {
        const res = await wx.cloud.callFunction({ name: 'getOpenId' });
        userId = res.result.openid;
        if (userId) wx.setStorageSync('openid', userId);
      }
      if (!userId) {
        userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      }

      const userInfo = { userId, nickName: tempNickName.trim(), avatarUrl: tempAvatarUrl };
      wx.setStorageSync('userInfo', userInfo);

      // 写入云端 users 集合
      await app.saveUser(userInfo);

      this.setData({ userInfo, hasLogin: true });
      this.refreshCheckins();
      wx.showToast({ title: '设置成功 🎉', icon: 'none' });
    } catch (err) {
      console.error('设置失败', err);
      wx.showToast({ title: '设置失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onCheckinTap() {
    if (!this.data.hasLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/checkin/checkin' });
  },

  onViewHistory() {
    wx.switchTab({ url: '/pages/history/history' });
  },
});
