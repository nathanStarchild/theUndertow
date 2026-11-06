const slotsInput = document.getElementById('slots');
const identifyButton = document.getElementById('identify');
const launchButton = document.getElementById('launch');
const displaysContainer = document.getElementById('displays');
const errorEl = document.getElementById('error');

let displays = [];
let savedAssignments = [];

function roleOptions(slots) {
  const options = [
    { value: 'unused', label: 'Unused' },
    { value: 'monitor', label: 'Monitor' },
  ];
  for (let i = 1; i <= slots; i++) options.push({ value: `proj-${i}`, label: `proj-${i}` });
  return options;
}

function currentAssignments() {
  return [...displaysContainer.querySelectorAll('select')].map((select) => ({
    displayId: Number(select.dataset.displayId),
    role: select.value,
  }));
}

// Monitor can be assigned to any number of displays; only duplicate proj-n assignments are an error.
function validate() {
  const counts = new Map();
  for (const { role } of currentAssignments()) {
    if (role === 'unused' || role === 'monitor') continue;
    counts.set(role, (counts.get(role) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, n]) => n > 1).map(([role]) => role);
  errorEl.textContent = duplicates.length ? `Assigned to more than one display: ${duplicates.join(', ')}` : '';
  launchButton.disabled = duplicates.length > 0;
  return duplicates.length === 0;
}

function renderRows() {
  const slots = parseInt(slotsInput.value, 10) || 1;
  const options = roleOptions(slots);

  displaysContainer.innerHTML = '';
  displays.forEach((display, i) => {
    const row = document.createElement('div');
    row.className = 'display-row';

    const label = document.createElement('span');
    label.textContent = `${i + 1}. ${display.label || 'Display'} (${display.size.width}x${display.size.height})`;

    const select = document.createElement('select');
    select.dataset.displayId = display.id;
    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    }
    const saved = savedAssignments.find((a) => a.displayId === display.id);
    select.value = saved && options.some((o) => o.value === saved.role) ? saved.role : 'unused';
    select.addEventListener('change', validate);

    row.appendChild(label);
    row.appendChild(select);
    displaysContainer.appendChild(row);
  });
  validate();
}

slotsInput.addEventListener('change', renderRows);
identifyButton.addEventListener('click', () => window.settingsAPI.identifyDisplays());

Promise.all([window.settingsAPI.getSettings(), window.settingsAPI.getDisplays()]).then(([settings, d]) => {
  displays = d;
  savedAssignments = settings.assignments || [];
  slotsInput.value = settings.projectorSlots || 3;
  renderRows();
});

launchButton.addEventListener('click', () => {
  if (!validate()) return;
  window.settingsAPI.launch({
    projectorSlots: parseInt(slotsInput.value, 10) || 3,
    assignments: currentAssignments(),
  });
});
