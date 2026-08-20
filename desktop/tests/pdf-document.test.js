const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DETAILS_PER_CHUNK,
  buildPdfChunkHtml,
  buildPdfChunks,
  buildTimelineLayout,
  formatFieldValue,
} = require('../pdf-document');

function payload(tasks) {
  return {
    title: 'Field Plan',
    eventId: 42,
    eventName: 'Synthetic Assembly',
    eventLocation: 'Test Hall',
    eventStartDate: '2032-04-21',
    eventEndDate: '2032-04-21',
    generatedAt: '2032-04-20T12:00:00.000Z',
    scheduleDayRange: { startHour: 6, endHour: 28 },
    days: [{ date: '2032-04-21', dayLabel: 'Wednesday', tasks }],
  };
}

function task(index, overrides = {}) {
  return {
    id: 1,
    name: `Operational task ${index}`,
    date: '2032-04-21',
    start_end_time: { start: '08:00', end: '09:00' },
    task_type_name: 'Operations',
    task_type_color: '#2563eb',
    location_name: 'Test Hall',
    resource_info: `Team ${index} | Person ${index}`,
    fields: { instructions: `Instruction ${index}` },
    field_definitions: [{ id: 'instructions', name: 'Instructions', type: 'text' }],
    optimised: { private: 'must-not-render' },
    final: { private: 'must-not-render' },
    credential: 'must-not-render',
    ...overrides,
  };
}

test('PDF documents are split into bounded day-detail chunks with stable references', () => {
  const document = buildPdfChunks(payload(Array.from({ length: 51 }, (_, index) => task(index + 1))));
  assert.equal(DETAILS_PER_CHUNK, 25);
  assert.equal(document.chunks.length, 3);
  assert.deepEqual(document.chunks.map((chunk) => chunk.details.length), [25, 25, 1]);
  assert.deepEqual(document.chunks.map((chunk) => chunk.includeTimeline), [true, false, false]);
  assert.equal(document.chunks[0].details[0].reference, 'T01');
  assert.equal(document.chunks[2].details[0].reference, 'T51');
});

test('static PDF HTML has no scripts, connections, or undisplayed payload fields', () => {
  const document = buildPdfChunks(payload([task(1)]));
  const html = buildPdfChunkHtml(document.metadata, document.chunks[0], {
    logoDataUrl: 'data:image/png;base64,AA==',
    fontDataUrl: 'data:font/woff2;base64,AA==',
  });
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /Operational task 1/);
  assert.match(html, /data-pdf-task-reference="T01"/);
  assert.doesNotMatch(html, /must-not-render/);
  assert.doesNotMatch(html, /credential/);
  assert.doesNotMatch(html, /optimised/);
  assert.doesNotMatch(html, /final/);
});

test('static PDF HTML escapes hostile display values', () => {
  const hostile = payload([
    task(1, {
      name: '<img src=x onerror=alert(1)>',
      location_name: '</style><script>fail()</script>',
      resource_info: '<b>untrusted allocation</b>',
    }),
  ]);
  hostile.title = '<script>title()</script>';
  const document = buildPdfChunks(hostile);
  const html = buildPdfChunkHtml(document.metadata, document.chunks[0]);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img src=x/i);
  assert.match(html, /&lt;script&gt;title\(\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;untrusted allocation&lt;\/b&gt;/);
});

test('duplicate imported task IDs do not affect references or timeline layout', () => {
  const document = buildPdfChunks(payload([
    task(1, { id: 7, start_end_time: { start: '08:00', end: '10:00' } }),
    task(2, { id: 7, start_end_time: { start: '08:30', end: '09:30' } }),
    task(3, { id: 7, start_end_time: { start: '09:00', end: '11:00' } }),
  ]));
  const day = document.chunks[0].day;
  assert.deepEqual(day.tasks.map((item) => item.reference), ['T01', 'T02', 'T03']);
  const layout = buildTimelineLayout(day.tasks, day.date, document.metadata.dayRange);
  assert.equal(layout.items.length, 3);
  assert.ok(layout.items.every((item) => item.width > 0 && item.width <= 100));
  assert.ok(new Set(layout.items.map((item) => item.left)).size > 1);
});

test('timeline sweep handles dense schedules without a pairwise overlap graph', () => {
  const tasks = Array.from({ length: 2000 }, (_, index) => ({
    ...task(index + 1),
    reference: `T${index + 1}`,
    title: `Task ${index + 1}`,
    taskType: 'Operations',
    colour: '#2563eb',
    location: '',
    clock: `${String(6 + (index % 18)).padStart(2, '0')}:00`,
    startEnd: {
      start: `${String(6 + (index % 18)).padStart(2, '0')}:00`,
      end: `${String(7 + (index % 18)).padStart(2, '0')}:00`,
    },
    timeRange: null,
  }));
  const started = Date.now();
  const layout = buildTimelineLayout(tasks, '2032-04-21', { startHour: 6, endHour: 24 });
  assert.equal(layout.items.length, 2000);
  assert.ok(Date.now() - started < 1000);
});

test('field formatting is bounded and never serialises arbitrary objects', () => {
  assert.equal(formatFieldValue({ label: 'Runbook', url: 'https://example.invalid/runbook' }), 'Runbook - https://example.invalid/runbook');
  assert.equal(formatFieldValue({ secret: 'not-displayable' }), '');
  assert.equal(formatFieldValue(['one', { name: 'two' }]), 'one, two');
});
