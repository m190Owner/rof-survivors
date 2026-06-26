// Comic-panel storyboard player. Renders a sequence of data-driven panels (see
// story.js) as full-screen comic panels built from the game's sprite art: themed
// backdrop, posed sprite images, speech bubbles, a narration caption, halftone +
// onomatopoeia. One panel at a time; tap / NEXT to advance, SKIP to jump to the end.
//
//   playStoryboard(panels, onDone)

const BG = {
  depot:  'radial-gradient(circle at 50% 32%, #3c4858, #161d28)',
  field:  'radial-gradient(circle at 50% 32%, #357a34, #122c0e)',
  desert: 'radial-gradient(circle at 50% 32%, #c79a4c, #543a18)',
  marsh:  'radial-gradient(circle at 50% 32%, #5e1d1d, #1c0707)',
  dark:   'radial-gradient(circle at 50% 36%, #2c1117, #050208)',
};

let panels = [];
let idx = 0;
let onDone = null;
let wired = false;
const el = {};

function grab() {
  el.screen = document.getElementById('story-screen');
  el.stage = document.getElementById('story-stage');
  el.caption = document.getElementById('story-caption');
  el.counter = document.getElementById('story-counter');
  el.next = document.getElementById('story-next');
  el.skip = document.getElementById('story-skip');
}

export function playStoryboard(list, done) {
  grab();
  panels = list || [];
  idx = 0;
  onDone = done || null;
  if (!wired) {
    wired = true;
    el.stage.addEventListener('click', advance);
    el.next.addEventListener('click', (e) => { e.stopPropagation(); advance(); });
    el.skip.addEventListener('click', (e) => { e.stopPropagation(); finish(); });
  }
  el.screen.classList.remove('hidden');
  render();
}

function render() {
  const p = panels[idx] || {};
  el.stage.style.background = BG[p.bg] || BG.dark;
  el.stage.innerHTML = '';

  for (const s of p.sprites || []) {
    const img = new Image();
    img.src = `./${s.img}.png`;
    img.className = 'story-sprite';
    img.style.left = s.x + '%';
    img.style.top = s.y + '%';
    const sc = s.scale || 1;
    img.style.transform = `translate(-50%,-50%) scale(${(s.flip ? -sc : sc)}, ${sc}) rotate(${s.rot || 0}deg)`;
    el.stage.appendChild(img);
  }
  for (const f of p.sfx || []) {
    const d = document.createElement('div');
    d.className = 'story-sfx';
    d.textContent = f.text;
    d.style.left = f.x + '%';
    d.style.top = f.y + '%';
    d.style.color = f.color || '#ffd23b';
    d.style.transform = `translate(-50%,-50%) rotate(${f.rot || 0}deg)`;
    el.stage.appendChild(d);
  }
  for (const b of p.bubbles || []) {
    const d = document.createElement('div');
    d.className = 'story-bubble tail-' + (b.tail || 'l');
    d.textContent = b.text;
    d.style.left = b.x + '%';
    d.style.top = b.y + '%';
    el.stage.appendChild(d);
  }

  el.caption.textContent = p.caption || '';
  el.caption.style.display = p.caption ? 'block' : 'none';
  el.counter.textContent = `${idx + 1} / ${panels.length}`;
  el.next.textContent = idx + 1 >= panels.length ? 'CONTINUE ▶' : 'NEXT ▶';

  // Pop-in animation.
  el.stage.classList.remove('pop');
  void el.stage.offsetWidth;
  el.stage.classList.add('pop');
}

function advance() {
  if (idx + 1 >= panels.length) { finish(); return; }
  idx++;
  render();
}

function finish() {
  el.screen.classList.add('hidden');
  const cb = onDone;
  onDone = null;
  if (cb) cb();
}
