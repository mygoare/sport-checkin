// pages/checkin/checkin.js
const app = getApp();

Page({
  data: {
    userInfo: null,
    content: '',
    presets: [
      { icon: '🏔️', label: '爬山',    placeholder: '爬山5公里' },
      { icon: '🏋️', label: '健身房',  placeholder: '健身房2小时' },
      { icon: '🏃', label: '跑步',    placeholder: '跑步5公里' },
      { icon: '🚴', label: '骑行',    placeholder: '骑行20公里' },
      { icon: '🏊', label: '游泳',    placeholder: '游泳1000米' },
      { icon: '🧘', label: '瑜伽',    placeholder: '瑜伽60分钟' },
      { icon: '⛹️', label: '篮球',    placeholder: '篮球2小时' },
      { icon: '🎾', label: '网球',    placeholder: '网球1小时' },
      { icon: '💪', label: '引体向上', placeholder: '引体向上20个' },
      { icon: '🦵', label: '深蹲',    placeholder: '深蹲100个' },
      { icon: '🤸', label: '跳绳',    placeholder: '跳绳500个' },
      { icon: '🧗', label: '攀岩',    placeholder: '攀岩1小时' },
    ],
    selectedPreset: null,
    isSubmitting: false,
    showCheckinDetail: true,
    charCount: 0,
    maxChars: 100,
  },

  onLoad() {
    this.setData({ showCheckinDetail: getApp().getConfig('showCheckinDetail') });
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      wx.navigateBack();
      return;
    }
    this.setData({ userInfo });
  },

  onBackTap() {
    wx.navigateBack();
  },

  onPresetTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const preset = this.data.presets[idx];
    this.setData({ selectedPreset: idx, content: preset.placeholder });
  },

  onContentInput(e) {
    const val = e.detail.value;
    this.setData({ content: val, charCount: val.length });
  },

  onClearContent() {
    this.setData({ content: '', charCount: 0, selectedPreset: null });
  },

  async onSubmit() {
    const { content, userInfo, isSubmitting } = this.data;
    if (isSubmitting) return;

    if (!content.trim()) {
      wx.showToast({ title: '请填写运动内容', icon: 'none' });
      return;
    }
    if (content.trim().length < 2) {
      wx.showToast({ title: '内容太短啦', icon: 'none' });
      return;
    }

    this.setData({ isSubmitting: true });

    try {
      await app.addCheckin(userInfo.userId, content.trim());
      wx.showToast({ title: '打卡成功！🎉', icon: 'success', duration: 1500 });
      this.setData({ isSubmitting: false });
      wx.navigateBack();
    } catch (err) {
      console.error('打卡失败', err);
      wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      this.setData({ isSubmitting: false });
    }
  },
});
