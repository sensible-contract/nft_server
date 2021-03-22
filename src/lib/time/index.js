class Time {
  static OneSecond = 1000;
  static OneMinute = 60 * 1000;
  static OneHour = 60 * 60 * 1000;
  static OneDay = 24 * 60 * 60 * 1000;

  static getTimeAfter(n) {
    return Date.now() + n;
  }

  static now() {
    return Date.now();
  }

  /**
   * 获取第几天的凌晨时间，n为0则是今天
   * @param n 天数
   */
  static getDaybreak(n) {
    return new Date(new Date().setHours(0, 0, 0, 0) + 86400000 * n);
  }
  static getNextWeekday(weekDay) {
    var d = new Date().getDay() || 7;
    var g = weekDay - d;
    if (g <= 0) g += 7;
    return this.getDaybreak(g);
  }

  static getDateInfo(d) {
    d = d || new Date();
    let year = d.getFullYear();
    let month = d.getMonth() + 1;
    let day = d.getDate();
    let hour = d.getHours();
    let timestamp = d.getTime();
    return { year, month, day, hour, timestamp };
  }

  static timeToDay(time) {
    return Math.floor((time + 28800000) / 86400000);
  }

  static formatGapString(val) {
    let ret = "";
    let min = 0,
      sec = 0,
      ms = 0;
    ms = val % 1000;
    if (val > 1000) {
      sec = Math.floor(val / 1000);
      min = Math.floor(sec / 60);
      sec = sec % 60;
    }
    ret = `${min}分钟${sec}秒${ms}毫秒`;
    return ret;
  }
}

module.exports = {
  Time,
};
