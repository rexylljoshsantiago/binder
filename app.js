/* ============================================================
   app.js — Binder core: state, navigation, screen rendering
   ============================================================ */

const ACCENTS = { amber:"#f0a857", cyan:"#6fc3d9", green:"#6fcf97", red:"#ec6a6a" };
const app = document.getElementById("app");

let view = { screen: "dashboard", subjectId: null, lessonId: null };
let cache = { subjects: [], lessonsBySubject: {} };
let quizAnswers = {}, quizResult = null;
let currentQuiz = [];
let attachmentUrls = {}; // objectURL cache per attachment id, cleaned on nav

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

async function refreshSubjects() {
  cache.subjects = (await DB.getSubjects()).sort((a,b)=>(a.order||0)-(b.order||0));
}
async function getLessons(subjectId) {
  const lessons = (await DB.getLessonsForSubject(subjectId)).sort((a,b)=>(a.order||0)-(b.order||0));
  cache.lessonsBySubject[subjectId] = lessons;
  return lessons;
}
async function progressFor(lessonId) {
  return (await DB.getProgress(lessonId)) || { lessonId, unlocked:false, done:false, bestScore:null };
}
async function subjectCompletion(subjectId) {
  const lessons = await getLessons(subjectId);
  if (lessons.length === 0) return 0;
  let done = 0;
  for (const l of lessons) {
    const p = await progressFor(l.id);
    if (p.done) done++;
  }
  return Math.round((done / lessons.length) * 100);
}
function starsFor(pct) {
  if (pct === null || pct === undefined) return "";
  const n = pct >= 90 ? 3 : pct >= 80 ? 2 : pct >= 70 ? 1 : 0;
  return "★".repeat(n) + "☆".repeat(3 - n);
}
async function ensureFirstLessonUnlocked(subjectId) {
  const lessons = await getLessons(subjectId);
  if (lessons.length === 0) return;
  const p0 = await progressFor(lessons[0].id);
  if (!p0.unlocked && !p0.done) {
    p0.unlocked = true;
    await DB.saveProgress(p0);
  }
}

const LOGO_MARK = `<svg viewBox="0 0 44 44" width="18" height="18" fill="none">
  <path d="M6 30 L6 12 Q6 9 9 9 Q17 9 22 14 L22 27 Q16 32 8 32 Q6 32 6 30 Z" fill="var(--text)" stroke="var(--text)" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M38 30 L38 12 Q38 9 35 9 Q27 9 22 14 L22 27 Q28 32 36 32 Q38 32 38 30 Z" fill="var(--amber)" stroke="var(--amber)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/* ---------- Header ---------- */
function renderHeader() {
  let crumbs = `<button onclick="goDashboard()">All Subjects</button>`;
  let actions = `<button class="icon-btn" title="Add subject" onclick="Editor.openSubjectEditor(null)">+</button>`;
  if (view.subjectId) {
    const subj = cache.subjects.find(s => s.id === view.subjectId);
    if (subj) {
      if (view.screen === "lessonList" || view.screen === "editSubject") {
        crumbs += `<span class="sep">/</span><span class="current">${esc(subj.name)}</span>`;
        actions = `<button class="icon-btn" title="Edit subject" onclick="Editor.openSubjectEditor('${subj.id}')">✎</button>
                   <button class="icon-btn" title="Add lesson" onclick="Editor.openLessonEditor('${subj.id}', null)">+</button>`;
      } else if (view.screen === "importLesson") {
        crumbs += `<span class="sep">/</span><button onclick="goSubject('${subj.id}')">${esc(subj.name)}</button><span class="sep">/</span><span class="current">Import lesson</span>`;
        actions = "";
      } else {
        crumbs += `<span class="sep">/</span><button onclick="goSubject('${subj.id}')">${esc(subj.name)}</button>`;
        if (view.lessonId) {
          const lessons = cache.lessonsBySubject[subj.id] || [];
          const lesson = lessons.find(l => l.id === view.lessonId);
          if (lesson) {
            const short = lesson.title.length > 26 ? lesson.title.slice(0,24) + "…" : lesson.title;
            crumbs += `<span class="sep">/</span><span class="current">${esc(short)}</span>`;
            if (view.screen === "lesson") {
              actions = `<button class="icon-btn" title="Edit lesson" onclick="Editor.openLessonEditor('${subj.id}','${lesson.id}')">✎</button>`;
            } else {
              actions = "";
            }
          }
        }
      }
    }
  }
  return `<header class="top"><div class="topbar">
    <div class="brand"><div class="brand-mark">${LOGO_MARK}</div><b>Binder</b></div>
    <nav class="crumbs">${crumbs}</nav>
    <div class="header-actions">${actions}</div>
  </div></header>`;
}

/* ---------- Dashboard ---------- */
async function renderDashboard() {
  await refreshSubjects();
  const cardsHtml = [];
  for (const s of cache.subjects) {
    const pct = await subjectCompletion(s.id);
    const accent = ACCENTS[s.accent] || ACCENTS.amber;
    const lessons = cache.lessonsBySubject[s.id] || [];
    cardsHtml.push(`<div class="subject-card" style="--accent:${accent}" onclick="goSubject('${s.id}')">
      <span class="tag">${esc(s.tag || "")}</span>
      <h3>${esc(s.name)}</h3>
      <div class="meta">${lessons.length} lesson${lessons.length===1?'':'s'}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="pct-row"><span>PROGRESS</span><span>${pct}%</span></div>
    </div>`);
  }
  cardsHtml.push(`<div class="add-card" onclick="Editor.openSubjectEditor(null)"><div class="plus">+</div><div>Add a subject</div></div>`);

  const emptyHint = cache.subjects.length === 0
    ? `<p class="lede">Nothing here yet — add your first subject to get started.</p>`
    : `<p class="lede">Pick a subject to continue down its lesson path, or jump into something new.</p>`;

  return `
    <section class="hero">
      <div class="wrap">
        <div class="eyebrow">1st Semester · Binder</div>
        <h1>Everything you're studying,<br>in one place.</h1>
        ${emptyHint}
      </div>
    </section>
    <section class="panel">
      <div class="wrap">
        <div class="panel-head"><div class="panel-head-left"><span class="panel-num">01</span><h2>Your Subjects</h2></div></div>
        <div class="subject-grid">${cardsHtml.join("")}</div>
      </div>
    </section>
    <footer>Binder · Personal study system</footer>
  `;
}

/* ---------- Lesson path (per subject) ---------- */
async function renderLessonList() {
  const subj = cache.subjects.find(s => s.id === view.subjectId) || await DB.getSubject(view.subjectId);
  if (!subj) { goDashboard(); return ""; }
  const accent = ACCENTS[subj.accent] || ACCENTS.amber;
  await ensureFirstLessonUnlocked(subj.id);
  const lessons = await getLessons(subj.id);

  const rowsHtml = [];
  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i];
    const p = await progressFor(l.id);
    let badgeClass = "locked", badgeContent = String(i+1).padStart(2,'0'), clickable = false, subLabel = "LOCKED";
    if (p.done) { badgeClass = "done"; badgeContent = "✓"; clickable = true; subLabel = "COMPLETED · TAP TO REVIEW"; }
    else if (p.unlocked) { badgeClass = "next"; clickable = true; subLabel = "READY TO START"; }
    const scoreHtml = p.done ? `<div class="row-score">${p.bestScore}%<div class="row-stars">${starsFor(p.bestScore)}</div></div>` : "";
    rowsHtml.push(`<div class="path-row ${clickable ? 'clickable' : 'locked'}" style="--accent:${accent}">
      <div class="node-badge ${badgeClass}" ${clickable?`onclick="goLesson('${subj.id}','${l.id}')" style="cursor:pointer"`:''}>${badgeContent}</div>
      <div style="flex:1" ${clickable?`onclick="goLesson('${subj.id}','${l.id}')" style="cursor:pointer"`:''}>
        <div class="row-title">${esc(l.title)}</div>
        <div class="row-sub">${subLabel}</div>
      </div>
      ${scoreHtml}
      <button class="icon-btn row-edit" title="Edit lesson" onclick="event.stopPropagation();Editor.openLessonEditor('${subj.id}','${l.id}')">✎</button>
    </div>`);
  }
  const addRow = `
    <div class="add-card" style="min-height:70px" onclick="Editor.openLessonEditor('${subj.id}', null)"><div class="plus" style="font-size:20px">+</div><div style="font-size:13px">Add a lesson</div></div>
    <div class="add-card" style="min-height:70px" onclick="Editor.openImportLesson('${subj.id}')"><div class="plus" style="font-size:20px">⇩</div><div style="font-size:13px">Import lesson (paste from Claude)</div></div>`;

  const emptyState = lessons.length === 0
    ? `<div class="empty-state">No lessons yet in ${esc(subj.name)}.<br>Tap "Add a lesson" to create the first one.</div>`
    : "";

  return `
    <section class="hero" style="padding:44px 0 30px;">
      <div class="wrap">
        <div class="eyebrow" style="--accent:${accent}">${esc(subj.tag || "SUBJECT")}</div>
        <h1 style="font-size:clamp(24px,4vw,36px)">${esc(subj.name)}</h1>
        <p class="lede">Work through the path in order — pass each quiz to unlock the next lesson.</p>
      </div>
    </section>
    <section class="panel" style="padding-top:0;border-top:none;">
      <div class="wrap">
        ${emptyState}
        <div class="path-list">${rowsHtml.join("")}${addRow}</div>
      </div>
    </section>
    <footer>Binder · ${esc(subj.name)}</footer>
  `;
}

/* ---------- Lesson content ---------- */
function renderBlock(block, idx, accent) {
  const num = String(idx + 1).padStart(2, '0');
  const head = `<div class="panel-head-left"><span class="panel-num">${num}</span><h2>${esc(block.title)}</h2></div>`;
  const sub = block.sub ? `<p class="panel-sub">${esc(block.sub)}</p>` : "";
  if (block.type === "twocol" || block.type === "grid3") {
    const gridClass = block.type === "twocol" ? "grid2" : "grid3";
    const cards = (block.cards || []).map(c => `<div class="card" style="--accent:${accent}"><h4>${esc(c.h4)}</h4><p>${esc(c.body)}</p></div>`).join("");
    const callout = block.callout ? `<div class="callout" style="--accent:${accent}"><b>Key insight — </b>${esc(block.callout)}</div>` : "";
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}<div class="${gridClass}">${cards}</div>${callout}</div></section>`;
  }
  if (block.type === "table") {
    const rows = (block.rows || []).map(r => `<tr>${r.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("");
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}<table class="compare"><tr>${(block.headers||[]).map(h => `<th>${esc(h)}</th>`).join("")}</tr>${rows}</table></div></section>`;
  }
  if (block.type === "checklist") {
    const items = (block.items || []).map(it => `<li>${esc(it)}</li>`).join("");
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}<ul class="checklist" style="--accent:${accent}">${items}</ul></div></section>`;
  }
  if (block.type === "code") {
    const note = block.note ? `<p style="margin-top:10px;color:var(--text-dim);font-size:14px;">${esc(block.note)}</p>` : "";
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}<pre class="code">${esc(block.code)}</pre>${note}</div></section>`;
  }
  if (block.type === "diagram") {
    const treeHtml = `<div class="tree"><ul>${renderTreeNode(block.tree, accent)}</ul></div>`;
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}${treeHtml}</div></section>`;
  }
  if (block.type === "svgdiagram") {
    return `<section class="panel"><div class="wrap"><div class="panel-head">${head}</div>${sub}<div class="svg-diagram" style="--accent:${accent}">${block.svg}</div></div></section>`;
  }
  return "";
}

function renderTreeNode(node, accent) {
  if (typeof node === "string") node = { name: node };
  let childrenHtml = "";
  if (node.children && node.children.length) {
    childrenHtml = `<ul>${node.children.map(c => renderTreeNode(c, accent)).join("")}</ul>`;
  }
  return `<li><div class="tree-node" style="--accent:${accent}">${esc(node.name)}</div>${childrenHtml}</li>`;
}

async function renderLessonPage() {
  const subj = cache.subjects.find(s => s.id === view.subjectId) || await DB.getSubject(view.subjectId);
  const lesson = await DB.getLesson(view.lessonId);
  if (!subj || !lesson) { goDashboard(); return ""; }
  const accent = ACCENTS[subj.accent] || ACCENTS.amber;
  const lessons = await getLessons(subj.id);
  const idx = lessons.findIndex(l => l.id === lesson.id);

  let attachHtml = "";
  if (lesson.attachmentId) {
    const att = await DB.getAttachment(lesson.attachmentId);
    if (att) {
      const url = URL.createObjectURL(att.blob);
      attachmentUrls[att.id] = url;
      attachHtml = `<a class="attach-box" href="${url}" download="${esc(att.filename)}">📎 ${esc(att.filename)}</a>`;
    }
  }
  const metaHtml = (lesson.meta || []).map(m => `<div>${esc(m.label)}<b>${esc(m.value)}</b></div>`).join("");
  const blocksHtml = (lesson.blocks || []).map((b, i) => renderBlock(b, i, accent)).join("");
  const blocksEmpty = (!lesson.blocks || lesson.blocks.length === 0)
    ? `<section class="panel"><div class="wrap"><div class="empty-state">This lesson has no content blocks yet. Tap the ✎ edit icon above to add some.</div></div></section>` : "";

  const quizBtn = (lesson.quiz && lesson.quiz.length > 0)
    ? `<button class="btn primary" onclick="goQuiz('${subj.id}','${lesson.id}')" style="background:${accent};border-color:${accent}">Take the quiz →</button>`
    : `<div style="color:var(--text-faint);font-family:'JetBrains Mono',monospace;font-size:12.5px;">No quiz added for this lesson yet.</div>`;

  return `
    <section class="hero">
      <div class="wrap">
        <div class="eyebrow" style="--accent:${accent}">${esc(lesson.eyebrow || `Lesson ${idx+1}`)}</div>
        <h1>${esc(lesson.title)}</h1>
        ${lesson.lede ? `<p class="lede">${esc(lesson.lede)}</p>` : ""}
        ${attachHtml}
        ${metaHtml ? `<div class="hero-meta">${metaHtml}</div>` : ""}
      </div>
    </section>
    ${blocksHtml}${blocksEmpty}
    <section class="panel">
      <div class="wrap" style="text-align:center;padding:10px 0 20px;">${quizBtn}</div>
    </section>
    <footer>Lesson ${idx+1} of ${lessons.length} · ${esc(subj.name)}</footer>
  `;
}

/* ---------- Quiz ---------- */
async function renderQuiz() {
  const subj = cache.subjects.find(s => s.id === view.subjectId) || await DB.getSubject(view.subjectId);
  const lesson = await DB.getLesson(view.lessonId);
  if (!subj || !lesson) { goDashboard(); return ""; }
  const accent = ACCENTS[subj.accent] || ACCENTS.amber;
  const qs = lesson.quiz || [];
  currentQuiz = qs;

  if (quizResult) {
    const passed = quizResult.pct >= 70;
    const msg = passed ? (quizResult.pct === 100 ? "Perfect score." : "Passed — next lesson unlocked.") : "Below 70% — give it another go.";
    return `
      <section class="panel" style="border-top:none;">
        <div class="wrap">
          <div class="result-panel ${passed ? 'pass' : 'fail'}">
            <div class="result-stars">${starsFor(quizResult.pct)}</div>
            <div class="result-score">${quizResult.pct}%</div>
            <div class="result-msg">${msg}</div>
            <div class="result-actions">
              <button class="btn" onclick="retakeQuiz()">Retake</button>
              <button class="btn primary" onclick="afterQuizNav(${passed})" style="background:${accent};border-color:${accent}">${passed ? 'Continue →' : 'Back to lesson'}</button>
            </div>
          </div>
        </div>
      </section>`;
  }

  const items = qs.map((q, i) => {
    let body = "";
    if (q.type === "mc") {
      body = `<div class="opt-list">` + (q.opts||[]).map((o, oi) => `
        <label class="opt ${quizAnswers[i] === oi ? 'selected' : ''}">
          <input type="radio" name="q${i}" ${quizAnswers[i] === oi ? 'checked' : ''} onclick="selectAnswer(${i},${oi})">
          ${esc(o)}
        </label>`).join("") + `</div>`;
    } else if (q.type === "tf") {
      body = `<div class="opt-list">
        <label class="opt ${quizAnswers[i] === true ? 'selected' : ''}"><input type="radio" name="q${i}" ${quizAnswers[i] === true ? 'checked' : ''} onclick="selectAnswer(${i},true)"> True</label>
        <label class="opt ${quizAnswers[i] === false ? 'selected' : ''}"><input type="radio" name="q${i}" ${quizAnswers[i] === false ? 'checked' : ''} onclick="selectAnswer(${i},false)"> False</label>
      </div>`;
    } else if (q.type === "fill") {
      body = `<input class="fill-input" placeholder="Type your answer" value="${esc(quizAnswers[i]||'')}" oninput="fillAnswer(${i}, this.value)">`;
    }
    return `<div class="quiz-q"><div class="qnum">Question ${i+1} of ${qs.length}</div><div class="qtext">${esc(q.q)}</div>${body}</div>`;
  }).join("");

  const allAnswered = qs.length > 0 && qs.every((q, i) => quizAnswers[i] !== undefined && quizAnswers[i] !== "");
  const answeredCount = qs.filter((q, i) => quizAnswers[i] !== undefined && quizAnswers[i] !== "").length;
  return `
    <section class="hero" style="padding:40px 0 20px;">
      <div class="wrap">
        <div class="eyebrow" style="--accent:${accent}">Quiz</div>
        <h1 style="font-size:clamp(22px,3.6vw,32px)">${esc(lesson.title)}</h1>
        <div class="mono" id="quizProgress" style="margin-top:10px;color:var(--text-faint);font-size:12.5px;">${answeredCount} of ${qs.length} answered</div>
      </div>
    </section>
    <section class="panel" style="border-top:none;">
      <div class="wrap">
        ${items || `<div class="empty-state">No questions yet.</div>`}
        <button class="btn primary" id="quizSubmitBtn" ${allAnswered ? '' : 'disabled'} onclick="submitQuiz()" style="background:${accent};border-color:${accent}">Submit quiz</button>
      </div>
    </section>
  `;
}

/* Lightweight update for fill-in-the-blank answers — avoids re-rendering the
   whole screen (and losing input focus / breaking the on-screen keyboard)
   on every keystroke. Only the submit button and progress text are touched. */
function fillAnswer(i, val) {
  quizAnswers[i] = val;
  const allAnswered = currentQuiz.length > 0 && currentQuiz.every((q, idx) => quizAnswers[idx] !== undefined && quizAnswers[idx] !== "");
  const btn = document.getElementById('quizSubmitBtn');
  if (btn) btn.disabled = !allAnswered;
  const answeredCount = currentQuiz.filter((q, idx) => quizAnswers[idx] !== undefined && quizAnswers[idx] !== "").length;
  const progress = document.getElementById('quizProgress');
  if (progress) progress.textContent = `${answeredCount} of ${currentQuiz.length} answered`;
}

/* ---------- Actions ---------- */
function releaseAttachmentUrls() {
  Object.values(attachmentUrls).forEach(u => URL.revokeObjectURL(u));
  attachmentUrls = {};
}
function goDashboard() { releaseAttachmentUrls(); view = { screen: "dashboard", subjectId: null, lessonId: null }; render(); }
function goSubject(id) { releaseAttachmentUrls(); view = { screen: "lessonList", subjectId: id, lessonId: null }; render(); }
function goLesson(subjId, lessonId) { releaseAttachmentUrls(); view = { screen: "lesson", subjectId: subjId, lessonId }; render(); }
function goQuiz(subjId, lessonId) { quizAnswers = {}; quizResult = null; view = { screen: "quiz", subjectId: subjId, lessonId }; render(); }
function selectAnswer(i, val) { quizAnswers[i] = val; render(); }

async function submitQuiz() {
  const lesson = await DB.getLesson(view.lessonId);
  let correctCount = 0;
  lesson.quiz.forEach((q, i) => {
    let ans = quizAnswers[i], ok = false;
    if (q.type === "mc") ok = ans === q.correct;
    else if (q.type === "tf") ok = ans === q.correct;
    else if (q.type === "fill") ok = String(ans).trim().toLowerCase() === String(q.correct).trim().toLowerCase();
    if (ok) correctCount++;
  });
  const pct = Math.round((correctCount / lesson.quiz.length) * 100);
  quizResult = { pct, correctCount };

  const p = await progressFor(lesson.id);
  if (p.bestScore === null || pct > p.bestScore) p.bestScore = pct;
  if (pct >= 70) {
    p.done = true;
    p.unlocked = true;
    await DB.saveProgress(p);
    const lessons = await getLessons(view.subjectId);
    const idx = lessons.findIndex(l => l.id === lesson.id);
    if (idx + 1 < lessons.length) {
      const nextP = await progressFor(lessons[idx+1].id);
      nextP.unlocked = true;
      await DB.saveProgress(nextP);
    }
  } else {
    await DB.saveProgress(p);
  }
  render();
}
function retakeQuiz() { quizAnswers = {}; quizResult = null; render(); }
async function afterQuizNav(passed) {
  const lessons = await getLessons(view.subjectId);
  const idx = lessons.findIndex(l => l.id === view.lessonId);
  if (passed && idx + 1 < lessons.length) goLesson(view.subjectId, lessons[idx+1].id);
  else goLesson(view.subjectId, view.lessonId);
}

/* ---------- Scroll rail ---------- */
function updateRail() {
  const h = document.documentElement;
  const scrolled = h.scrollTop;
  const max = h.scrollHeight - h.clientHeight;
  const pct = max > 0 ? (scrolled / max) * 100 : 0;
  const el = document.getElementById('railFill');
  if (el) el.style.height = pct + '%';
}
document.addEventListener('scroll', updateRail);

/* ---------- Main render ---------- */
async function render() {
  let body = "";
  if (view.screen === "dashboard") body = await renderDashboard();
  else if (view.screen === "lessonList") body = await renderLessonList();
  else if (view.screen === "lesson") body = await renderLessonPage();
  else if (view.screen === "quiz") body = await renderQuiz();
  else if (view.screen === "editSubject") body = await Editor.renderSubjectEditor();
  else if (view.screen === "editLesson") body = await Editor.renderLessonEditor();
  else if (view.screen === "importLesson") body = await Editor.renderImportLesson();

  app.innerHTML = renderHeader() + body;
  window.scrollTo(0, 0);
  updateRail();
}

async function init() {
  await refreshSubjects();
  render();
}
init();
