export function epochToApi(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}.${values.month}.${values.day}`, time: `${values.hour}.${values.minute}.${values.second}` };
}

export function epochToInput(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const v = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}`;
}

export function inputToEpoch(input, timeZone) {
  const match = input.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/);
  if (!match) throw new Error('Informe uma data e hora válidas.');
  const [, year, month, day, hour, minute, second = '00', millis = '0'] = match;
  const millisecond = Number(millis.padEnd(3, '0'));
  const wanted = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, millisecond);
  let epoch = wanted;
  for (let i = 0; i < 3; i += 1) {
    const localParts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
    const v = Object.fromEntries(localParts.map(part => [part.type, part.value]));
    const seen = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
    epoch += wanted - (seen + (epoch % 1000 + 1000) % 1000);
  }
  const checked = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const result = Object.fromEntries(checked.map(part => [part.type, part.value]));
  if (`${result.year}-${result.month}-${result.day}T${result.hour}:${result.minute}:${result.second}` !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) {
    throw new Error('Esse horário não existe no fuso configurado.');
  }
  return epoch;
}


let timelineDayCache = { key: '', days: [] };
export function timelineDayBoundaries(start, end, timeZone) {
  const key = `${start}|${end}|${timeZone}`;
  if (timelineDayCache.key === key) return timelineDayCache.days;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayNumber = epoch => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000;
  };
  const days = [];
  for (let day = dayNumber(start) + 1, last = dayNumber(end); day <= last; day++) {
    let low = start, high = end;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dayNumber(middle) >= day) high = middle; else low = middle;
    }
    if (high > start && high <= end) days.push(high);
  }
  timelineDayCache = { key, days };
  return days;
}
