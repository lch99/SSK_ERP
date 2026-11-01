// Business days are Malaysian days, wherever the server runs (servers usually
// keep UTC, which is 8 hours behind). APP_TZ changes it.
const TZ = process.env.APP_TZ || 'Asia/Kuala_Lumpur';
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

const localToday = (d = new Date()) => ymd.format(d);
const localTime = (d = new Date()) => hm.format(d);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

module.exports = { localToday, localTime, addDays, TZ };
