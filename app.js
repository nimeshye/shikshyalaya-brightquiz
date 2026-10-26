/* Shikshyalaya Nepal BrightQuiz student app. See README.md before using with real students. */
const $ = (id) => document.getElementById(id);
const readyConfig = window.SUPABASE_URL && !window.SUPABASE_URL.includes("YOUR-PROJECT")
  && window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const db = readyConfig && window.supabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
let currentUser = null;
let availableQuizzes = [];
const emojiBySubject = {Mathematics:"➗",Science:"🔬",English:"📚",Computer:"💻",Social:"🌎"};

$("year").textContent = new Date().getFullYear();
function message(text, isError=true) { $("loginMessage").textContent = text; $("loginMessage").style.color = isError ? "#b42318" : "#28753b"; }
function escapeHtml(value="") { return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return message("Add your Supabase project URL and key in config.js first.");
  const username = $("username").value.trim().toLowerCase();
  const password = $("password").value;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return message("Use the username provided by your teacher.");
  const button = $("loginForm").querySelector("button");
  button.disabled = true; button.textContent = "Signing in…"; message("");
  try {
    // Admin creates each student's Supabase Auth account with this matching email alias.
    const { data, error } = await db.auth.signInWithPassword({ email: `${username}@students.schoolquiz.app`, password });
    if (error) throw error;
    currentUser = data.user;
    await showDashboard();
  } catch (err) {
    message("Sign-in failed. Check your username and password, then try again.");
  } finally { button.disabled = false; button.innerHTML = 'Sign in <span>→</span>'; }
});

$("logoutBtn").addEventListener("click", async () => {
  if (db) await db.auth.signOut();
  currentUser = null; $("dashboardView").classList.add("hidden"); $("loginView").classList.remove("hidden");
  $("loginForm").reset(); message("");
});
$("filterBtn").addEventListener("click", loadQuizzes);

async function showDashboard() {
  $("loginView").classList.add("hidden"); $("dashboardView").classList.remove("hidden");
  const { data: profile, error } = await db.from("profiles").select("username, display_name, class_id, role").eq("id", currentUser.id).single();
  if (error || !profile) throw error || new Error("Profile not found");
  if (profile.role === "admin") {
    window.location.href = "admin.html";
    return;
  }
  if (profile.role !== "student") {
    await db.auth.signOut();
    throw new Error("This account is not allowed to access the student dashboard.");
  }
  $("studentName").textContent = profile.display_name || profile.username;
  const [{data: studentClass}, {data: subjects}, {data: attempts}] = await Promise.all([
    profile.class_id
      ? db.from("classes").select("id,name").eq("id", profile.class_id).maybeSingle()
      : Promise.resolve({data:null}),
    db.from("subjects").select("id,name").order("name"),
    db.from("attempts").select("id,score,total_questions").eq("student_id", currentUser.id).eq("status","submitted")
  ]);
  // Students can only choose their assigned class; the database policies enforce this too.
  $("classFilter").innerHTML = studentClass
    ? `<option value="${studentClass.id}">${escapeHtml(studentClass.name)}</option>`
    : '<option value="">No class assigned</option>';
  $("classFilter").value = studentClass?.id || "";
  $("classFilter").disabled = true;
  $("subjectFilter").innerHTML = '<option value="">All subjects</option>' + (subjects||[]).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  const completed = attempts || [];
  $("attemptCount").textContent = completed.length;
  $("averageScore").textContent = completed.length ? Math.round(completed.reduce((n,a)=>n+(a.total_questions ? a.score/a.total_questions*100 : 0),0)/completed.length)+"%" : "—";
  await loadQuizzes();
}

async function loadQuizzes() {
  if (!db || !currentUser) return;
  $("quizGrid").innerHTML = '<div class="empty-state">Loading quizzes…</div>';
  let query = db.from("quizzes").select("id,title,description,class_id,subject_id,duration_minutes,classes(name),subjects(name)").eq("published",true).order("created_at",{ascending:false});
  const classId = $("classFilter").value, subjectId = $("subjectFilter").value;
  if (classId) query = query.eq("class_id",classId);
  if (subjectId) query = query.eq("subject_id",subjectId);
  const {data, error} = await query;
  if (error) { $("quizGrid").innerHTML = '<div class="empty-state">Could not load quizzes. Check the Supabase SQL setup and access policies.</div>'; return; }
  availableQuizzes = data || [];
  $("quizCount").textContent = availableQuizzes.length;
  renderQuizzes();
}
function renderQuizzes() {
  if (!availableQuizzes.length) { $("quizGrid").innerHTML = '<div class="empty-state">No published quizzes match these filters yet. Check back with your teacher!</div>'; return; }
  $("quizGrid").innerHTML = availableQuizzes.map(q => `<article class="quiz-card"><div class="quiz-emoji">${emojiBySubject[q.subjects?.name]||"📝"}</div><h3>${escapeHtml(q.title)}</h3><p>${escapeHtml(q.description||"Test your knowledge and see how you do.")}</p><div class="quiz-meta">${escapeHtml(q.classes?.name||"Class")} · ${escapeHtml(q.subjects?.name||"Subject")} · ${q.duration_minutes||10} min</div><button class="primary-btn" onclick="startQuiz('${q.id}')">Start quiz →</button></article>`).join("");
}
window.startQuiz = async function(quizId) {
  $("quizRunner").classList.remove("hidden"); $("resultsPanel").classList.add("hidden");
  $("quizRunner").innerHTML = '<p class="muted">Loading questions…</p>';
  $("quizRunner").scrollIntoView({behavior:"smooth",block:"start"});
  const quiz = availableQuizzes.find(q=>q.id===quizId);
  const {data: questions, error} = await db.from("quiz_questions").select("id,question_text,options,sort_order").eq("quiz_id",quizId).order("sort_order");
  if (error || !questions?.length) { $("quizRunner").innerHTML = '<p class="muted">This quiz has no questions yet, or you do not have permission to access it.</p>'; return; }
  $("quizRunner").innerHTML = `<div class="runner-top"><div><h2>${escapeHtml(quiz.title)}</h2><p class="muted">${questions.length} questions · ${quiz.duration_minutes||10} minutes</p></div><button class="outline-btn" onclick="$('quizRunner').classList.add('hidden')">Close</button></div><form id="quizForm">${questions.map((q,i)=>`<div class="question"><h3>${i+1}. ${escapeHtml(q.question_text)}</h3>${(q.options||[]).map((opt,j)=>`<label class="option"><input type="radio" name="${q.id}" value="${j}" required> <span>${escapeHtml(opt)}</span></label>`).join("")}</div>`).join("")}<div class="runner-actions"><button type="button" class="outline-btn" onclick="$('quizRunner').classList.add('hidden')">Cancel</button><button class="primary-btn compact" type="submit">Submit answers</button></div></form>`;
  $("quizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.currentTarget.querySelector('button[type="submit"]'); submitBtn.disabled = true; submitBtn.textContent = "Submitting…";
    const answers = questions.map(q => ({question_id:q.id, selected_option:Number(new FormData(e.currentTarget).get(q.id))}));
    // Server-side function scores answers without revealing answer keys to students.
    const {data, error} = await db.rpc("submit_quiz", {p_quiz_id:quizId, p_answers:answers});
    if (error) { submitBtn.disabled=false; submitBtn.textContent="Submit answers"; alert("Could not submit quiz. Please contact your teacher."); return; }
    $("quizRunner").classList.add("hidden");
    $("resultsPanel").classList.remove("hidden");
    $("resultsPanel").innerHTML = `<div class="eyebrow" style="color:var(--green)">QUIZ COMPLETED</div><h2>${escapeHtml(quiz.title)}</h2><div class="score-number">${data.score} / ${data.total_questions}</div><p class="muted">You scored ${data.total_questions ? Math.round(data.score/data.total_questions*100) : 0}%. Great effort — keep learning!</p><button class="primary-btn compact" onclick="$('resultsPanel').classList.add('hidden');loadQuizzes()">Back to quizzes</button>`;
    $("resultsPanel").scrollIntoView({behavior:"smooth",block:"center"});
    const {data: attempts} = await db.from("attempts").select("id,score,total_questions").eq("student_id",currentUser.id).eq("status","submitted");
    const completed=attempts||[]; $("attemptCount").textContent=completed.length;
    $("averageScore").textContent=completed.length?Math.round(completed.reduce((n,a)=>n+(a.total_questions?a.score/a.total_questions*100:0),0)/completed.length)+"%":"—";
  });
};
