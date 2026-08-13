/* ============================================================
   editor.js — Add/edit Subjects, Lessons, Blocks, Quiz questions
   ============================================================ */

const Editor = {
  draft: null,          // lesson currently being edited (deep copy)
  subjectDraft: null,   // subject currently being edited (deep copy)
  pendingFile: null,    // File object staged for upload on save

  /* ---------- Import lesson (paste JSON drafted by Claude in chat) ---------- */
  openImportLesson(subjectId) {
    Editor.importError = "";
    view = { screen: "importLesson", subjectId, lessonId: null };
    render();
  },

  async renderImportLesson() {
    const subj = cache.subjects.find(s => s.id === view.subjectId) || await DB.getSubject(view.subjectId);
    const errorHtml = Editor.importError
      ? `<div class="callout" style="--accent:var(--red);border-color:var(--red)"><b>Couldn't import — </b>${esc(Editor.importError)}</div>` : "";
    return `
      <section class="hero" style="padding:44px 0 20px;">
        <div class="wrap">
          <div class="eyebrow">Import Lesson</div>
          <h1 style="font-size:clamp(24px,4vw,34px)">Paste content from Claude</h1>
          <p class="lede">Send Claude the file (PDF, PPT, image, notes — whatever you've got) and ask it to format the lesson for "${esc(subj ? subj.name : 'this subject')}". Paste what it gives you below.</p>
        </div>
      </section>
      <section class="panel" style="border-top:none;">
        <div class="wrap">
          ${errorHtml}
          <div class="field">
            <label>Pasted lesson content</label>
            <textarea id="importBox" placeholder="Paste the block Claude gives you here..." style="min-height:260px;font-family:'JetBrains Mono',monospace;font-size:12.5px;"></textarea>
          </div>
          <details style="margin-bottom:18px;">
            <summary style="cursor:pointer;color:var(--text-faint);font-family:'JetBrains Mono',monospace;font-size:12px;">What format does Claude need to use?</summary>
            <pre class="code" style="margin-top:10px;">{
  "title": "Lesson title",
  "eyebrow": "Lesson 1 · Topic",
  "lede": "One or two sentence intro",
  "meta": [{"label":"Course","value":"MATH101"}],
  "blocks": [
    {"type":"twocol","title":"...","sub":"...",
     "cards":[{"h4":"...","body":"..."},{"h4":"...","body":"..."}],
     "callout":"optional key insight"},
    {"type":"table","title":"...","headers":["",""],"rows":[["",""]]},
    {"type":"checklist","title":"...","items":["...","..."]},
    {"type":"code","title":"...","code":"...","note":"optional"}
  ],
  "quiz": [
    {"type":"mc","q":"...","opts":["A","B","C"],"correct":0},
    {"type":"tf","q":"...","correct":true},
    {"type":"fill","q":"...","correct":"answer"}
  ]
}</pre>
          </details>
        </div>
      </section>
      <div class="save-bar"><div class="wrap">
        <button class="btn ghost" onclick="goSubject('${view.subjectId}')">Cancel</button>
        <button class="btn primary" onclick="Editor.parseImport()">Parse & continue</button>
      </div></div>
    `;
  },

  parseImport() {
    const raw = document.getElementById("importBox").value.trim();
    if (!raw) { Editor.importError = "Paste something first."; render(); return; }
    let parsed;
    try {
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const jsonSlice = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
      parsed = JSON.parse(jsonSlice);
    } catch (e) {
      Editor.importError = "That doesn't look like valid JSON. Make sure you copied the whole block, including the { and } at the start and end.";
      render();
      return;
    }
    if (!parsed.title) {
      Editor.importError = "The pasted content needs at least a \"title\" field.";
      render();
      return;
    }
    const lessons = cache.lessonsBySubject[view.subjectId] || [];
    Editor.draft = {
      id: DB.uid("lesson"), subjectId: view.subjectId,
      title: parsed.title || "", eyebrow: parsed.eyebrow || "", lede: parsed.lede || "",
      meta: Array.isArray(parsed.meta) ? parsed.meta : [],
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      quiz: Array.isArray(parsed.quiz) ? parsed.quiz : [],
      attachmentId: null, order: lessons.length
    };
    Editor.pendingFile = null;
    Editor.importError = "";
    view = { screen: "editLesson", subjectId: view.subjectId, lessonId: Editor.draft.id, _newLesson: true };
    toast("Imported — review and save below");
    render();
  },

  /* ---------- Subject editor ---------- */
  openSubjectEditor(subjectId) {
    Editor.subjectDraft = null;
    view = { screen: "editSubject", subjectId: subjectId, lessonId: null };
    // stash whether this is a new subject via a flag on view
    view._newSubject = !subjectId;
    render();
  },

  async renderSubjectEditor() {
    if (!Editor.subjectDraft) {
      if (view.subjectId && !view._newSubject) {
        const existing = await DB.getSubject(view.subjectId);
        Editor.subjectDraft = existing ? { ...existing } : { id: DB.uid("subj"), name: "", tag: "", accent: "amber", order: cache.subjects.length };
      } else {
        Editor.subjectDraft = { id: DB.uid("subj"), name: "", tag: "", accent: "amber", order: cache.subjects.length };
        view.subjectId = Editor.subjectDraft.id;
      }
    }
    const d = Editor.subjectDraft;
    const isNew = view._newSubject;
    const accentDots = Object.entries(ACCENTS).map(([key, hex]) => `
      <div class="accent-dot ${d.accent === key ? 'active' : ''}" style="background:${hex}" onclick="Editor.setSubjectAccent('${key}')">${d.accent===key?'✓':''}</div>
    `).join("");

    return `
      <section class="hero" style="padding:44px 0 20px;">
        <div class="wrap">
          <div class="eyebrow">${isNew ? "New Subject" : "Edit Subject"}</div>
          <h1 style="font-size:clamp(24px,4vw,34px)">${isNew ? "Add a subject" : "Edit " + esc(d.name || "subject")}</h1>
        </div>
      </section>
      <section class="panel" style="border-top:none;">
        <div class="wrap">
          <div class="field">
            <label>Subject name</label>
            <input type="text" value="${esc(d.name)}" placeholder="e.g. Calculus 1" oninput="Editor.subjectDraft.name=this.value">
          </div>
          <div class="field">
            <label>Course code (optional)</label>
            <input type="text" value="${esc(d.tag)}" placeholder="e.g. MATH101" oninput="Editor.subjectDraft.tag=this.value">
          </div>
          <div class="field">
            <label>Accent color</label>
            <div class="accent-picker">${accentDots}</div>
          </div>
        </div>
      </section>
      <div class="save-bar"><div class="wrap">
        ${!isNew ? `<button class="btn danger" onclick="Editor.deleteSubject('${d.id}')">Delete subject</button>` : ""}
        <button class="btn ghost" onclick="Editor.cancelSubjectEdit()">Cancel</button>
        <button class="btn primary" onclick="Editor.saveSubject()">Save subject</button>
      </div></div>
    `;
  },
  setSubjectAccent(key) { Editor.subjectDraft.accent = key; render(); },
  cancelSubjectEdit() {
    const wasNew = view._newSubject;
    Editor.subjectDraft = null;
    if (wasNew) goDashboard(); else goSubject(view.subjectId);
  },
  async saveSubject() {
    const d = Editor.subjectDraft;
    if (!d.name || !d.name.trim()) { toast("Give the subject a name first"); return; }
    await DB.saveSubject(d);
    await refreshSubjects();
    toast("Subject saved");
    Editor.subjectDraft = null;
    goSubject(d.id);
  },
  async deleteSubject(id) {
    if (!confirm("Delete this subject and all its lessons? This can't be undone.")) return;
    await DB.deleteSubject(id);
    await refreshSubjects();
    Editor.subjectDraft = null;
    toast("Subject deleted");
    goDashboard();
  },

  /* ---------- Lesson editor ---------- */
  openLessonEditor(subjectId, lessonId) {
    Editor.draft = null;
    Editor.pendingFile = null;
    view = { screen: "editLesson", subjectId, lessonId, _newLesson: !lessonId };
    render();
  },

  async ensureDraftLoaded() {
    if (Editor.draft) return;
    if (view.lessonId && !view._newLesson) {
      const existing = await DB.getLesson(view.lessonId);
      Editor.draft = existing ? JSON.parse(JSON.stringify(existing)) : Editor.blankLesson();
    } else {
      Editor.draft = Editor.blankLesson();
    }
  },
  blankLesson() {
    const lessons = cache.lessonsBySubject[view.subjectId] || [];
    return {
      id: DB.uid("lesson"), subjectId: view.subjectId,
      title: "", eyebrow: "", lede: "",
      meta: [], blocks: [], quiz: [],
      attachmentId: null, order: lessons.length
    };
  },

  async renderLessonEditor() {
    await Editor.ensureDraftLoaded();
    const d = Editor.draft;
    const isNew = view._newLesson;

    const metaRows = (d.meta || []).map((m, i) => `
      <div class="mini-row">
        <div class="mini-fields">
          <input type="text" placeholder="Label (e.g. Course)" value="${esc(m.label)}" oninput="Editor.draft.meta[${i}].label=this.value">
          <input type="text" placeholder="Value (e.g. MATH101)" value="${esc(m.value)}" oninput="Editor.draft.meta[${i}].value=this.value">
        </div>
        <button class="btn small danger" onclick="Editor.removeMeta(${i})">✕</button>
      </div>`).join("");

    let attachHtml = "";
    if (d.attachmentId && !Editor.pendingFile) {
      const att = await DB.getAttachment(d.attachmentId);
      if (att) attachHtml = `<div class="attach-box">📎 ${esc(att.filename)} <button class="btn small danger" style="margin-left:10px" onclick="Editor.removeAttachment()">Remove</button></div>`;
    } else if (Editor.pendingFile) {
      attachHtml = `<div class="attach-box">📎 ${esc(Editor.pendingFile.name)} (pending save) <button class="btn small danger" style="margin-left:10px" onclick="Editor.pendingFile=null;render()">Remove</button></div>`;
    }

    const blocksHtml = (d.blocks || []).map((b, i) => Editor.renderBlockEditor(b, i)).join("");

    const typePicker = `
      <div class="type-picker">
        <button onclick="Editor.addBlock('twocol')">+ Two-column cards</button>
        <button onclick="Editor.addBlock('grid3')">+ Three cards</button>
        <button onclick="Editor.addBlock('table')">+ Comparison table</button>
        <button onclick="Editor.addBlock('checklist')">+ Checklist</button>
        <button onclick="Editor.addBlock('code')">+ Code block</button>
      </div>`;

    const quizHtml = (d.quiz || []).map((q, i) => Editor.renderQuestionEditor(q, i)).join("");
    const typePickerQuiz = `
      <div class="type-picker">
        <button onclick="Editor.addQuestion('mc')">+ Multiple choice</button>
        <button onclick="Editor.addQuestion('tf')">+ True / False</button>
        <button onclick="Editor.addQuestion('fill')">+ Fill in the blank</button>
      </div>`;

    return `
      <section class="hero" style="padding:44px 0 20px;">
        <div class="wrap">
          <div class="eyebrow">${isNew ? "New Lesson" : "Edit Lesson"}</div>
          <h1 style="font-size:clamp(24px,4vw,34px)">${isNew ? "Add a lesson" : "Edit " + esc(d.title || "lesson")}</h1>
        </div>
      </section>

      <section class="panel" style="border-top:none;">
        <div class="wrap">
          <div class="panel-head"><div class="panel-head-left"><h2>Basics</h2></div></div>
          <div class="field">
            <label>Lesson title</label>
            <input type="text" value="${esc(d.title)}" placeholder="e.g. Limits & Continuity" oninput="Editor.draft.title=this.value">
          </div>
          <div class="field-row">
            <div class="field">
              <label>Eyebrow label (optional)</label>
              <input type="text" value="${esc(d.eyebrow)}" placeholder="e.g. Lesson 1 · Foundations" oninput="Editor.draft.eyebrow=this.value">
            </div>
            <div class="field">
              <label>Attachment (image / PDF / PPT)</label>
              <input type="file" accept="image/*,application/pdf,.ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation" onchange="Editor.onFileChosen(event)">
            </div>
          </div>
          ${attachHtml}
          <div class="field">
            <label>Intro / summary</label>
            <textarea placeholder="A sentence or two introducing what this lesson covers." oninput="Editor.draft.lede=this.value">${esc(d.lede)}</textarea>
          </div>
          <div class="field">
            <label>Meta details (optional — course, prerequisite, outcome...)</label>
            <div class="mini-list">${metaRows}</div>
            <button class="btn small" style="margin-top:10px" onclick="Editor.addMeta()">+ Add detail</button>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="wrap">
          <div class="panel-head"><div class="panel-head-left"><span class="panel-num">02</span><h2>Content blocks</h2></div></div>
          <p class="panel-sub">Build the lesson body out of sections. Skip code blocks for non-coding subjects.</p>
          ${blocksHtml || `<div class="empty-state">No content blocks yet — add one below.</div>`}
          ${typePicker}
        </div>
      </section>

      <section class="panel">
        <div class="wrap">
          <div class="panel-head"><div class="panel-head-left"><span class="panel-num">03</span><h2>Quiz</h2></div></div>
          <p class="panel-sub">70% or higher passes and unlocks the next lesson.</p>
          ${quizHtml || `<div class="empty-state">No quiz questions yet — add one below.</div>`}
          ${typePickerQuiz}
        </div>
      </section>

      <div class="save-bar"><div class="wrap">
        ${!isNew ? `<button class="btn danger" onclick="Editor.deleteLesson('${d.id}')">Delete lesson</button>` : ""}
        <button class="btn ghost" onclick="Editor.cancelLessonEdit()">Cancel</button>
        <button class="btn primary" onclick="Editor.saveLesson()">Save lesson</button>
      </div></div>
    `;
  },

  /* ---- meta ---- */
  addMeta() { Editor.draft.meta.push({ label: "", value: "" }); render(); },
  removeMeta(i) { Editor.draft.meta.splice(i, 1); render(); },

  /* ---- attachment ---- */
  onFileChosen(e) {
    const file = e.target.files[0];
    if (file) { Editor.pendingFile = file; render(); }
  },
  removeAttachment() { Editor.draft.attachmentId = null; render(); },

  /* ---- blocks ---- */
  addBlock(type) {
    const base = { type, title: "", sub: "" };
    if (type === "twocol") base.cards = [{ h4: "", body: "" }, { h4: "", body: "" }];
    if (type === "grid3") base.cards = [{ h4: "", body: "" }, { h4: "", body: "" }, { h4: "", body: "" }];
    if (type === "table") { base.headers = ["", ""]; base.rows = [["", ""]]; }
    if (type === "checklist") base.items = [""];
    if (type === "code") { base.code = ""; base.note = ""; }
    Editor.draft.blocks.push(base);
    render();
  },
  removeBlock(i) { Editor.draft.blocks.splice(i, 1); render(); },
  moveBlock(i, dir) {
    const arr = Editor.draft.blocks;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    render();
  },
  updateBlockField(i, field, value) { Editor.draft.blocks[i][field] = value; },
  updateCard(bi, ci, field, value) { Editor.draft.blocks[bi].cards[ci][field] = value; },
  addCard(bi) { Editor.draft.blocks[bi].cards.push({ h4: "", body: "" }); render(); },
  removeCard(bi, ci) { Editor.draft.blocks[bi].cards.splice(ci, 1); render(); },
  updateChecklistItem(bi, ii, value) { Editor.draft.blocks[bi].items[ii] = value; },
  addChecklistItem(bi) { Editor.draft.blocks[bi].items.push(""); render(); },
  removeChecklistItem(bi, ii) { Editor.draft.blocks[bi].items.splice(ii, 1); render(); },
  updateHeader(bi, hi, value) { Editor.draft.blocks[bi].headers[hi] = value; },
  addColumn(bi) { Editor.draft.blocks[bi].headers.push(""); Editor.draft.blocks[bi].rows.forEach(r => r.push("")); render(); },
  updateCell(bi, ri, ci, value) { Editor.draft.blocks[bi].rows[ri][ci] = value; },
  addRow(bi) { const cols = Editor.draft.blocks[bi].headers.length; Editor.draft.blocks[bi].rows.push(new Array(cols).fill("")); render(); },
  removeRow(bi, ri) { Editor.draft.blocks[bi].rows.splice(ri, 1); render(); },

  renderBlockEditor(b, i) {
    let body = "";
    if (b.type === "twocol" || b.type === "grid3") {
      const cards = (b.cards || []).map((c, ci) => `
        <div class="mini-row">
          <div class="mini-fields">
            <input type="text" placeholder="Card heading" value="${esc(c.h4)}" oninput="Editor.updateCard(${i},${ci},'h4',this.value)">
            <textarea placeholder="Card body" rows="2" oninput="Editor.updateCard(${i},${ci},'body',this.value)">${esc(c.body)}</textarea>
          </div>
          <button class="btn small danger" onclick="Editor.removeCard(${i},${ci})">✕</button>
        </div>`).join("");
      body = `
        <div class="mini-list">${cards}</div>
        <button class="btn small" style="margin-top:10px" onclick="Editor.addCard(${i})">+ Add card</button>
        <div class="field" style="margin-top:14px">
          <label>Callout / key insight (optional)</label>
          <textarea placeholder="A short highlighted takeaway" oninput="Editor.updateBlockField(${i},'callout',this.value)">${esc(b.callout||"")}</textarea>
        </div>`;
    } else if (b.type === "table") {
      const headers = (b.headers || []).map((h, hi) => `<input type="text" placeholder="Column ${hi+1}" value="${esc(h)}" oninput="Editor.updateHeader(${i},${hi},this.value)">`).join("");
      const rows = (b.rows || []).map((r, ri) => `
        <div class="mini-row">
          <div class="mini-fields" style="flex-direction:row;gap:8px;">
            ${r.map((cell, ci) => `<input type="text" placeholder="Cell" value="${esc(cell)}" oninput="Editor.updateCell(${i},${ri},${ci},this.value)">`).join("")}
          </div>
          <button class="btn small danger" onclick="Editor.removeRow(${i},${ri})">✕</button>
        </div>`).join("");
      body = `
        <div class="field"><label>Column headers</label><div class="mini-row" style="border:none;background:none;padding:0;"><div class="mini-fields" style="flex-direction:row;gap:8px;">${headers}</div></div></div>
        <button class="btn small" onclick="Editor.addColumn(${i})">+ Add column</button>
        <div class="field" style="margin-top:14px"><label>Rows</label><div class="mini-list">${rows}</div></div>
        <button class="btn small" style="margin-top:10px" onclick="Editor.addRow(${i})">+ Add row</button>`;
    } else if (b.type === "checklist") {
      const items = (b.items || []).map((it, ii) => `
        <div class="mini-row">
          <div class="mini-fields"><input type="text" placeholder="List item" value="${esc(it)}" oninput="Editor.updateChecklistItem(${i},${ii},this.value)"></div>
          <button class="btn small danger" onclick="Editor.removeChecklistItem(${i},${ii})">✕</button>
        </div>`).join("");
      body = `<div class="mini-list">${items}</div><button class="btn small" style="margin-top:10px" onclick="Editor.addChecklistItem(${i})">+ Add item</button>`;
    } else if (b.type === "code") {
      body = `
        <div class="field"><label>Code</label><textarea style="font-family:'JetBrains Mono',monospace;min-height:130px" placeholder="Paste your code snippet" oninput="Editor.updateBlockField(${i},'code',this.value)">${esc(b.code||"")}</textarea></div>
        <div class="field"><label>Note (optional)</label><input type="text" placeholder="A short line explaining the snippet" value="${esc(b.note||"")}" oninput="Editor.updateBlockField(${i},'note',this.value)"></div>`;
    }
    return `
      <div class="block-editor">
        <div class="block-editor-head">
          <span class="type-tag">${esc(b.type)}</span>
          <div class="block-actions">
            <button class="icon-btn" title="Move up" onclick="Editor.moveBlock(${i},-1)">↑</button>
            <button class="icon-btn" title="Move down" onclick="Editor.moveBlock(${i},1)">↓</button>
            <button class="icon-btn" title="Remove block" onclick="Editor.removeBlock(${i})">✕</button>
          </div>
        </div>
        <div class="block-editor-body">
          <div class="field-row">
            <div class="field"><label>Section title</label><input type="text" placeholder="e.g. Key Concepts" value="${esc(b.title)}" oninput="Editor.updateBlockField(${i},'title',this.value)"></div>
            <div class="field"><label>Subtitle (optional)</label><input type="text" placeholder="One line of context" value="${esc(b.sub||"")}" oninput="Editor.updateBlockField(${i},'sub',this.value)"></div>
          </div>
          ${body}
        </div>
      </div>`;
  },

  /* ---- quiz ---- */
  addQuestion(type) {
    const base = { type, q: "" };
    if (type === "mc") { base.opts = ["", ""]; base.correct = 0; }
    if (type === "tf") base.correct = true;
    if (type === "fill") base.correct = "";
    Editor.draft.quiz.push(base);
    render();
  },
  removeQuestion(i) { Editor.draft.quiz.splice(i, 1); render(); },
  moveQuestion(i, dir) {
    const arr = Editor.draft.quiz;
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    render();
  },
  updateQuestionText(i, value) { Editor.draft.quiz[i].q = value; },
  updateOption(qi, oi, value) { Editor.draft.quiz[qi].opts[oi] = value; },
  addOption(qi) { Editor.draft.quiz[qi].opts.push(""); render(); },
  removeOption(qi, oi) {
    const q = Editor.draft.quiz[qi];
    q.opts.splice(oi, 1);
    if (q.correct >= q.opts.length) q.correct = 0;
    render();
  },
  setCorrectMC(qi, oi) { Editor.draft.quiz[qi].correct = oi; render(); },
  setCorrectTF(qi, val) { Editor.draft.quiz[qi].correct = val; render(); },
  updateFillAnswer(qi, value) { Editor.draft.quiz[qi].correct = value; },

  renderQuestionEditor(q, i) {
    let body = "";
    if (q.type === "mc") {
      const opts = (q.opts || []).map((o, oi) => `
        <div class="mini-row">
          <div class="mini-fields"><input type="text" placeholder="Option ${oi+1}" value="${esc(o)}" oninput="Editor.updateOption(${i},${oi},this.value)"></div>
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-faint);white-space:nowrap;">
            <input type="radio" name="correct${i}" ${q.correct===oi?'checked':''} onclick="Editor.setCorrectMC(${i},${oi})"> correct
          </label>
          <button class="btn small danger" onclick="Editor.removeOption(${i},${oi})">✕</button>
        </div>`).join("");
      body = `<div class="mini-list">${opts}</div><button class="btn small" style="margin-top:10px" onclick="Editor.addOption(${i})">+ Add option</button>`;
    } else if (q.type === "tf") {
      body = `<div class="opt-list" style="max-width:220px">
        <label class="opt ${q.correct===true?'selected':''}"><input type="radio" name="tf${i}" ${q.correct===true?'checked':''} onclick="Editor.setCorrectTF(${i},true)"> True is correct</label>
        <label class="opt ${q.correct===false?'selected':''}"><input type="radio" name="tf${i}" ${q.correct===false?'checked':''} onclick="Editor.setCorrectTF(${i},false)"> False is correct</label>
      </div>`;
    } else if (q.type === "fill") {
      body = `<div class="field"><label>Correct answer (case-insensitive match)</label><input type="text" placeholder="e.g. boolean" value="${esc(q.correct||"")}" oninput="Editor.updateFillAnswer(${i},this.value)"></div>`;
    }
    return `
      <div class="block-editor">
        <div class="block-editor-head">
          <span class="type-tag">${q.type === 'mc' ? 'Multiple choice' : q.type === 'tf' ? 'True / False' : 'Fill in the blank'}</span>
          <div class="block-actions">
            <button class="icon-btn" title="Move up" onclick="Editor.moveQuestion(${i},-1)">↑</button>
            <button class="icon-btn" title="Move down" onclick="Editor.moveQuestion(${i},1)">↓</button>
            <button class="icon-btn" title="Remove question" onclick="Editor.removeQuestion(${i})">✕</button>
          </div>
        </div>
        <div class="block-editor-body">
          <div class="field"><label>Question</label><input type="text" placeholder="Type the question" value="${esc(q.q)}" oninput="Editor.updateQuestionText(${i},this.value)"></div>
          ${body}
        </div>
      </div>`;
  },

  cancelLessonEdit() {
    const subjId = view.subjectId;
    Editor.draft = null; Editor.pendingFile = null;
    goSubject(subjId);
  },

  async saveLesson() {
    const d = Editor.draft;
    if (!d.title || !d.title.trim()) { toast("Give the lesson a title first"); return; }

    if (Editor.pendingFile) {
      const file = Editor.pendingFile;
      const attId = DB.uid("att");
      await DB.saveAttachment({ id: attId, lessonId: d.id, filename: file.name, type: file.type, blob: file });
      d.attachmentId = attId;
    }

    await DB.saveLesson(d);

    const existingProgress = await DB.getProgress(d.id);
    if (!existingProgress) {
      const lessons = await getLessons(d.subjectId);
      const isFirst = lessons.filter(l => l.id !== d.id).length === 0;
      await DB.saveProgress({ lessonId: d.id, unlocked: isFirst, done: false, bestScore: null });
    }

    await getLessons(d.subjectId);
    toast("Lesson saved");
    const subjId = d.subjectId;
    Editor.draft = null; Editor.pendingFile = null;
    goSubject(subjId);
  },

  async deleteLesson(id) {
    if (!confirm("Delete this lesson? This can't be undone.")) return;
    const subjId = Editor.draft.subjectId;
    await DB.deleteLesson(id);
    await getLessons(subjId);
    Editor.draft = null;
    toast("Lesson deleted");
    goSubject(subjId);
  }
};
