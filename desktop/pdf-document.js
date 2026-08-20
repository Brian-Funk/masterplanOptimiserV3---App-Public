const DETAILS_PER_CHUNK = 25;
const DEFAULT_DAY_RANGE = Object.freeze({ startHour: 6, endHour: 24 });
const OMITTED_FIELD_TYPES = new Set([
  'persons_list',
  'capabilities_list',
  'location',
  'time',
]);

function boundedText(value, maximum = 2000) {
  if (typeof value !== 'string') return '';
  const normalised = value.normalize('NFKC').trim();
  const characters = Array.from(normalised);
  if (characters.length <= maximum) return normalised;
  return `${characters.slice(0, maximum - 1).join('')}…`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function scalarDisplayValue(value, maximum = 2000) {
  if (typeof value === 'string') return boundedText(value, maximum);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return '';
}

function objectDisplayValue(value) {
  const label = scalarDisplayValue(value.label, 1000) || scalarDisplayValue(value.name, 1000);
  const url = scalarDisplayValue(value.url, 2000);
  if (label && url && label !== url) return `${label} - ${url}`;
  return url || label || scalarDisplayValue(value.value, 2000);
}

function formatFieldValue(value) {
  if (value == null) return '';
  const scalar = scalarDisplayValue(value, 4000);
  if (scalar) return scalar;
  if (Array.isArray(value)) {
    return boundedText(
      value
        .slice(0, 100)
        .map((item) => {
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            return objectDisplayValue(item);
          }
          return scalarDisplayValue(item, 1000);
        })
        .filter(Boolean)
        .join(', '),
      6000,
    );
  }
  if (typeof value === 'object') return objectDisplayValue(value);
  return '';
}

function safeColour(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : '#4f46e5';
}

function taskTime(task) {
  const range = task.time_range || task.start_end_time;
  if (range && typeof range === 'object') {
    const start = scalarDisplayValue(range.start, 20);
    const end = scalarDisplayValue(range.end, 20);
    if (start || end) return `${start || '?'} - ${end || '?'}`;
  }
  return scalarDisplayValue(task.time, 20) || 'Not scheduled';
}

function taskSortKey(task, originalIndex) {
  const start = task.start_end_time?.start || task.time_range?.start || task.time || '99:99';
  return `${task.date || '9999-99-99'}T${start}:${String(originalIndex).padStart(5, '0')}`;
}

function detailFields(task) {
  const fields = [];
  const seen = new Set();
  const add = (labelValue, rawValue) => {
    const label = boundedText(labelValue, 200);
    const value = formatFieldValue(rawValue);
    if (!label || !value) return;
    const identity = `${label.toLocaleLowerCase()}\u0000${value}`;
    if (seen.has(identity) || fields.length >= 100) return;
    seen.add(identity);
    fields.push({ label, value });
  };

  const definitions = Array.isArray(task.field_definitions)
    ? task.field_definitions.slice(0, 200)
    : [];
  for (const definition of definitions) {
    if (!definition || OMITTED_FIELD_TYPES.has(definition.type)) continue;
    add(definition.name, task.fields?.[definition.id]);
  }
  const extras = Array.isArray(task._extra_card_fields)
    ? task._extra_card_fields.slice(0, 100)
    : [];
  for (const extra of extras) add(extra?.label, extra?.value);
  return fields;
}

function allocationLines(task) {
  const summary = boundedText(task.resource_info, 10000);
  if (!summary) return [];
  return summary
    .split(/\s+\|\s+/)
    .map((line) => boundedText(line, 2000))
    .filter(Boolean)
    .slice(0, 100);
}

function printableTask(task, reference, originalIndex) {
  const startEnd = task.start_end_time && typeof task.start_end_time === 'object'
    ? {
        start: scalarDisplayValue(task.start_end_time.start, 20),
        end: scalarDisplayValue(task.start_end_time.end, 20),
      }
    : null;
  const timeRange = task.time_range && typeof task.time_range === 'object'
    ? {
        start: scalarDisplayValue(task.time_range.start, 20),
        end: scalarDisplayValue(task.time_range.end, 20),
      }
    : null;
  return {
    reference,
    stableIndex: originalIndex,
    date: scalarDisplayValue(task.date, 10),
    title: scalarDisplayValue(task.name, 500) || 'Unnamed task',
    taskType: scalarDisplayValue(task.task_type_name, 240) || 'Operational task',
    colour: safeColour(task.task_type_color),
    location: scalarDisplayValue(task.location_name, 500),
    time: taskTime(task),
    clock: scalarDisplayValue(startEnd?.start || timeRange?.start || task.time, 20),
    startEnd,
    timeRange,
    allocations: allocationLines(task),
    fields: detailFields(task),
  };
}

function buildDayModel(day) {
  const ordered = day.tasks
    .map((task, originalIndex) => ({ task, originalIndex }))
    .sort((left, right) =>
      taskSortKey(left.task, left.originalIndex).localeCompare(
        taskSortKey(right.task, right.originalIndex),
      ),
    );
  return {
    date: day.date,
    dayLabel: boundedText(day.dayLabel, 240) || day.date,
    tasks: ordered.map(({ task, originalIndex }, index) =>
      printableTask(task, `T${String(index + 1).padStart(2, '0')}`, originalIndex),
    ),
  };
}

function normaliseDayRange(value) {
  const startHour = Number(value?.startHour);
  const endHour = Number(value?.endHour);
  if (
    Number.isInteger(startHour) &&
    Number.isInteger(endHour) &&
    startHour >= 0 &&
    startHour <= 23 &&
    endHour > startHour &&
    endHour <= 36
  ) {
    return { startHour, endHour };
  }
  return { ...DEFAULT_DAY_RANGE };
}

function clockMinutes(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function dayDifference(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

function taskInterval(task, selectedDate) {
  const range = task.startEnd || task.timeRange;
  const startClock = range?.start || task.clock;
  const endClock = range?.end || '';
  const startBase = clockMinutes(startClock);
  if (startBase === null) return null;
  const offset = dayDifference(selectedDate, task.date || selectedDate) * 1440;
  const start = startBase + offset;
  const endBase = clockMinutes(endClock);
  if (endBase === null) return [start, start + 60];
  let end = endBase + offset;
  if (end <= start) end += 1440;
  return [start, end];
}

class MinHeap {
  constructor(compare) {
    this.values = [];
    this.compare = compare;
  }

  get size() {
    return this.values.length;
  }

  peek() {
    return this.values[0];
  }

  push(value) {
    const values = this.values;
    values.push(value);
    let index = values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(values[parent], value) <= 0) break;
      values[index] = values[parent];
      index = parent;
    }
    values[index] = value;
  }

  pop() {
    if (this.values.length === 0) return undefined;
    const first = this.values[0];
    const last = this.values.pop();
    if (this.values.length > 0) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.values.length) break;
        const child = right < this.values.length && this.compare(this.values[right], this.values[left]) < 0
          ? right
          : left;
        if (this.compare(this.values[child], last) >= 0) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

/** Build timeline columns in O(n log n), including per-overlap-component widths. */
function buildTimelineLayout(tasks, selectedDate, suppliedRange) {
  const range = normaliseDayRange(suppliedRange);
  const startMinute = range.startHour * 60;
  const endMinute = range.endHour * 60;
  const hourHeight = Math.max(28, Math.min(52, 460 / Math.max(range.endHour - range.startHour, 1)));
  const minimumDuration = Math.max(1, Math.round(17 * 60 / hourHeight));
  const positioned = tasks.map((task, index) => {
    const interval = taskInterval(task, selectedDate);
    const rawStart = interval?.[0] ?? startMinute;
    const rawEnd = interval?.[1] ?? rawStart + minimumDuration;
    const start = Math.min(Math.max(rawStart, startMinute), endMinute - 1);
    const end = Math.min(endMinute, Math.max(start + minimumDuration, rawEnd));
    return { index, task, start, end, column: 0, totalColumns: 1 };
  });
  const ordered = [...positioned].sort(
    (left, right) => left.start - right.start || right.end - left.end || left.index - right.index,
  );
  let component = [];
  let componentEnd = -1;
  const flush = () => {
    if (component.length === 0) return;
    const active = new MinHeap((left, right) => left.end - right.end || left.column - right.column);
    const free = new MinHeap((left, right) => left - right);
    let columns = 0;
    let maximum = 1;
    for (const item of component) {
      while (active.size && active.peek().end <= item.start) free.push(active.pop().column);
      item.column = free.size ? free.pop() : columns++;
      active.push({ end: item.end, column: item.column });
      maximum = Math.max(maximum, active.size);
    }
    for (const item of component) item.totalColumns = maximum;
    component = [];
  };
  for (const item of ordered) {
    if (component.length && item.start >= componentEnd) flush();
    component.push(item);
    componentEnd = Math.max(componentEnd, item.end);
  }
  flush();
  return {
    totalHeight: Math.max(32, ((endMinute - startMinute) / 60) * hourHeight),
    hourLabels: Array.from({ length: range.endHour - range.startHour + 1 }, (_, index) => ({
      label: `${String((range.startHour + index) % 24).padStart(2, '0')}:00`,
      top: index * hourHeight,
    })),
    items: positioned.map((item) => ({
      task: item.task,
      top: ((item.start - startMinute) / 60) * hourHeight,
      height: Math.max(17, ((item.end - item.start) / 60) * hourHeight),
      left: item.column * (100 / item.totalColumns),
      width: 100 / item.totalColumns,
    })),
  };
}

function buildPdfChunks(payload) {
  const days = payload.days.map(buildDayModel);
  const chunks = [];
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    const chunkCount = Math.max(1, Math.ceil(day.tasks.length / DETAILS_PER_CHUNK));
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      chunks.push({
        sequence: chunks.length,
        dayIndex,
        dayCount: days.length,
        chunkIndex,
        chunkCount,
        includeTimeline: chunkIndex === 0,
        day,
        details: day.tasks.slice(
          chunkIndex * DETAILS_PER_CHUNK,
          (chunkIndex + 1) * DETAILS_PER_CHUNK,
        ),
      });
    }
  }
  return {
    metadata: {
      title: boundedText(payload.title, 120),
      eventName: boundedText(payload.eventName, 240),
      eventLocation: boundedText(payload.eventLocation, 500),
      generatedAt: payload.generatedAt,
      dayRange: normaliseDayRange(payload.scheduleDayRange),
      dayCount: days.length,
      taskCount: days.reduce((sum, day) => sum + day.tasks.length, 0),
    },
    chunks,
  };
}

function renderHeader(metadata, chunk, logoDataUrl) {
  const continuation = chunk.chunkIndex > 0
    ? ` · details ${chunk.chunkIndex + 1}/${chunk.chunkCount}`
    : '';
  return `<header class="header">
    <div class="brand">
      ${logoDataUrl ? `<img src="${escapeHtml(logoDataUrl)}" alt="MP-OPT" width="52" height="52">` : '<div class="logo-fallback">MP</div>'}
      <div class="divider"></div>
      <div><p class="kicker">Optimised Schedule</p><h1>${escapeHtml(metadata.title)}</h1></div>
    </div>
    <div class="event-meta"><strong>${escapeHtml(metadata.eventName)}</strong>
      ${metadata.eventLocation ? `<span>${escapeHtml(metadata.eventLocation)}</span>` : ''}
      <span>${escapeHtml(chunk.day.dayLabel)}${escapeHtml(continuation)}</span>
      <small>Generated ${escapeHtml(new Date(metadata.generatedAt).toLocaleString('en-GB'))}</small>
    </div>
  </header>`;
}

function renderTimeline(metadata, chunk) {
  if (!chunk.includeTimeline) return '';
  const layout = buildTimelineLayout(chunk.day.tasks, chunk.day.date, metadata.dayRange);
  return `<section class="timeline-section">
    <div class="section-heading"><div><p>Visual schedule</p><h2>${escapeHtml(chunk.day.dayLabel)}</h2></div><span>${chunk.day.tasks.length} ${chunk.day.tasks.length === 1 ? 'task' : 'tasks'}</span></div>
    <div class="timeline" data-pdf-timeline style="height:${layout.totalHeight.toFixed(2)}px">
      <div class="time-labels">${layout.hourLabels.map((hour) => `<span style="top:${hour.top.toFixed(2)}px">${escapeHtml(hour.label)}</span>`).join('')}</div>
      <div class="timeline-canvas">
        ${layout.hourLabels.map((hour) => `<span class="hour-line" style="top:${hour.top.toFixed(2)}px"></span>`).join('')}
        ${layout.items.map((item) => `<article class="timeline-task" data-pdf-timeline-task style="top:${item.top.toFixed(2)}px;height:${item.height.toFixed(2)}px;left:calc(${item.left.toFixed(5)}% + 1px);width:calc(${item.width.toFixed(5)}% - 2px);border-left-color:${item.task.colour}">
          <div><strong>${escapeHtml(item.task.reference)}</strong><span>${escapeHtml(item.task.clock)}</span></div>
          <p>${escapeHtml(item.task.title)}</p>${item.task.location ? `<small>${escapeHtml(item.task.location)}</small>` : ''}
        </article>`).join('')}
      </div>
    </div>
  </section>`;
}

function renderDetail(detail) {
  const allocations = detail.allocations.length
    ? `<div><dt>Allocations</dt><dd>${detail.allocations.map((value) => `<span class="allocation">${escapeHtml(value)}</span>`).join('')}</dd></div>`
    : '';
  const fields = detail.fields
    .map((field) => `<div><dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd></div>`)
    .join('');
  return `<article class="task-detail" data-pdf-task-reference="${escapeHtml(detail.reference)}">
    <div class="accent" style="background:${detail.colour}"></div>
    <div class="task-heading"><span class="reference">${escapeHtml(detail.reference)}</span><div><h3>${escapeHtml(detail.title)}</h3><span>${escapeHtml(detail.taskType)}</span></div><time>${escapeHtml(detail.time)}</time></div>
    <dl>${detail.location ? `<div><dt>Location</dt><dd>${escapeHtml(detail.location)}</dd></div>` : ''}${allocations}${fields}</dl>
  </article>`;
}

function styles(fontDataUrl) {
  const fontFace = fontDataUrl
    ? `@font-face{font-family:'Source Sans 3';src:url('${fontDataUrl}') format('woff2');font-weight:400 800;font-style:normal;font-display:block}`
    : '';
  return `${fontFace}
    @page{size:A4 portrait;margin:9mm 10mm 13mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font:10pt 'Source Sans 3',Arial,sans-serif}main{width:100%}.header{display:flex;align-items:center;justify-content:space-between;gap:6mm;margin-bottom:5mm;border-bottom:1px solid #dbe3f0;padding-bottom:3mm}.brand{display:flex;min-width:0;align-items:center;gap:3mm}.brand img,.logo-fallback{width:14mm;height:14mm;object-fit:contain;flex:none}.logo-fallback{display:grid;place-items:center;border-radius:3mm;background:#4f46e5;color:#fff;font-weight:800}.divider{width:1px;height:13mm;background:linear-gradient(#2563eb,#7c3aed)}.kicker,.section-heading p,.details-heading p{margin:0 0 .5mm;color:#4f46e5;font-size:7.5pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase}h1{max-width:105mm;margin:0;overflow-wrap:anywhere;font-size:16pt;line-height:1.08}.event-meta{display:flex;max-width:62mm;flex-direction:column;align-items:flex-end;color:#4b5563;font-size:8.5pt;line-height:1.25;text-align:right}.event-meta strong{color:#111827;font-size:9.5pt}.event-meta small{margin-top:1mm;color:#6b7280;font-size:7pt}.timeline-section{margin-bottom:5mm;break-inside:avoid}.section-heading,.details-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:5mm;border-bottom:1px solid #e5e7eb;padding-bottom:2mm}.section-heading{margin-bottom:2.5mm}.section-heading h2,.details-heading h2{margin:0;font-size:12pt;line-height:1.15}.section-heading>span,.details-heading>span{color:#6b7280;font-size:8pt;text-align:right}.timeline{position:relative;width:100%;min-height:32px;padding-left:13mm}.time-labels{position:absolute;inset:0 auto 0 0;width:12mm;color:#64748b;font-size:6.5pt;font-variant-numeric:tabular-nums}.time-labels span{position:absolute;right:1.5mm;transform:translateY(-50%)}.timeline-canvas{position:relative;width:100%;height:100%;overflow:hidden;border:1px solid #dbe3f0;border-radius:1.5mm;background:#fff}.hour-line{position:absolute;right:0;left:0;border-top:1px solid #e5e7eb}.timeline-task{position:absolute;overflow:hidden;border:1px solid #dbe3f0;border-left-width:1.2mm;border-radius:1mm;padding:1mm 1.2mm;background:#f8fafc;font-size:6.5pt;line-height:1.1}.timeline-task>div{display:flex;justify-content:space-between;gap:1mm;color:#475569;font-size:5.8pt}.timeline-task strong{color:#4338ca}.timeline-task p{margin:.6mm 0 0;overflow:hidden;font-weight:700;line-height:1.12}.timeline-task small{display:block;margin-top:.4mm;overflow:hidden;color:#64748b;font-size:5.8pt;white-space:nowrap;text-overflow:ellipsis}.details-heading{margin-bottom:2.5mm}.task-detail{position:relative;margin-bottom:2.5mm;overflow:hidden;border:1px solid #dbe3f0;border-radius:2.5mm;background:#fff;box-shadow:0 1px 2px rgb(15 23 42/.05);break-inside:avoid}.accent{position:absolute;inset:0 auto 0 0;width:1.3mm}.task-heading{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:3mm;padding:3mm 3.5mm 2.5mm 4.5mm;background:linear-gradient(90deg,#f8fafc,#fff)}.task-heading h3{margin:0;font-size:10pt;line-height:1.2;overflow-wrap:anywhere}.task-heading div>span,.task-heading time{color:#64748b;font-size:7.5pt}.reference{border-radius:1.5mm;background:#4f46e5;padding:1mm 1.8mm;color:#fff;font-size:8pt;font-weight:700;line-height:1}.task-heading time{white-space:nowrap;font-weight:600}.task-detail dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2mm 5mm;margin:0;padding:0 3.5mm 3mm 4.5mm}.task-detail dl>div{min-width:0;border-top:1px solid #eef2f7;padding-top:1.5mm}.task-detail dt{color:#6b7280;font-size:6.8pt;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.task-detail dd{margin:.5mm 0 0;overflow-wrap:anywhere;color:#1f2937;font-size:8.2pt;white-space:pre-wrap}.allocation{display:block}a{color:inherit}img{image-rendering:auto}`;
}

function buildPdfChunkHtml(metadata, chunk, assets = {}) {
  const titleSuffix = chunk.chunkIndex > 0 ? ` (continued ${chunk.chunkIndex + 1})` : '';
  // frame-ancestors is delivered by the protocol response header only because
  // Chromium reports it as an error when the directive appears in a meta tag.
  const contentSecurityPolicy = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}"><meta name="color-scheme" content="light"><title>${escapeHtml(metadata.title)}${escapeHtml(titleSuffix)}</title><style>${styles(assets.fontDataUrl || '')}</style></head><body>
    <main data-pdf-root data-expected-details="${chunk.details.length}" data-expected-timeline="${chunk.includeTimeline ? chunk.day.tasks.length : 0}">
      ${renderHeader(metadata, chunk, assets.logoDataUrl || '')}
      ${renderTimeline(metadata, chunk)}
      <section><div class="details-heading"><div><p>Task details</p><h2>${escapeHtml(chunk.day.dayLabel)}${chunk.chunkIndex > 0 ? ` · continued ${chunk.chunkIndex + 1}/${chunk.chunkCount}` : ''}</h2></div><span>${escapeHtml(metadata.eventName)}${metadata.eventLocation ? ` - ${escapeHtml(metadata.eventLocation)}` : ''}</span></div>
        ${chunk.details.map(renderDetail).join('')}
      </section>
    </main></body></html>`;
}

module.exports = {
  DETAILS_PER_CHUNK,
  boundedText,
  buildDayModel,
  buildPdfChunkHtml,
  buildPdfChunks,
  buildTimelineLayout,
  escapeHtml,
  formatFieldValue,
  normaliseDayRange,
};
