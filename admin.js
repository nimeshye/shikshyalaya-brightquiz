const $ = id => document.getElementById(id);
const configReady = window.SUPABASE_URL && !window.SUPABASE_URL.includes("YOUR-PROJECT") &&
  window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
const db = configReady && window.supabase ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY) : null;
let adminUser = null, questionCounter = 0;
$("year").textContent = new Date().getFullYear();

function esc(v="") { return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function status(el, text, error=true) { $(el).textContent=text; $(el).style.color=error?"#b42318":"#28753b"; }
function usernameEmail(username) { return `${username.trim().toLowerCase()}@students.schoolquiz.app`; }

$("adminLoginForm").addEventListener("submit", async e => {
  e.preventDefault();
  if (!db) return status("adminLoginMessage","Configure your Supabase URL and key in config.js first.");
  const username=$("adminUsername").value.trim().toLowerCase(), password=$("adminPassword").value;
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return status("adminLoginMessage","Enter the administrator username provided by the database owner.");
  const btn=e.currentTarget.querySelector("button[type=submit]"); btn.disabled=true; btn.textContent="Signing in…";
  try {
    const {data,error}=await db.auth.signInWithPassword({email:usernameEmail(username),password});
    if(error) throw error;
    const {data:profile,error:profileError}=await db.from("profiles").select("id,username,display_name,role").eq("id",data.user.id).single();
    if(profileError || !profile || profile.role!=="admin") {
      await db.auth.signOut();
      throw new Error("This account does not have administrator permission.");
    }
    adminUser=data.user;
    $("adminLoginView").classList.add("hidden"); $("adminView").classList.remove("hidden");
    await loadAdminData();
  } catch(err) { status("adminLoginMessage",err.message==="This account does not have administrator permission."?err.message:"Sign-in failed. Check the administrator username and password."); }
  finally {btn.disabled=false;btn.innerHTML='Sign in to admin <span>→</span>';}
});

$("adminLogoutBtn").addEventListener("click", async()=>{ if(db) await db.auth.signOut(); adminUser=null; $("adminView").classList.add("hidden"); $("adminLoginView").classList.remove("hidden"); $("adminLoginForm").reset(); });
$("refreshAdminBtn").addEventListener("click",loadAdminData);
$("addQuestionBtn").addEventListener("click",()=>addQuestionEditor());
$("createQuizForm").addEventListener("submit",saveQuiz);

function addQuestionEditor() {
  const n=++questionCounter, wrap=document.createElement("div"); wrap.className="question-edit-card"; wrap.dataset.questionNumber=n;
  wrap.innerHTML=`<div class="question-builder-heading"><strong>Question ${n}</strong><button type="button" class="remove-question" aria-label="Remove question">Remove</button></div>
  <label>Question text</label><textarea class="question-text" rows="2" maxlength="1000" required placeholder="Type the question"></textarea>
  <div class="options-grid">${[0,1,2,3].map((j)=>`<div><label>Option ${String.fromCharCode(65+j)}</label><input class="question-option" required maxlength="250" placeholder="Answer option ${j+1}"></div>`).join("")}</div>
  <label>Correct answer</label><select class="correct-option"><option value="0">Option A</option><option value="1">Option B</option><option value="2">Option C</option><option value="3">Option D</option></select>`;
  wrap.querySelector(".remove-question").addEventListener("click",()=>{wrap.remove();renumberQuestions();});
  $("questionEditor").appendChild(wrap);
}
function renumberQuestions(){[...$("questionEditor").children].forEach((el,i)=>el.querySelector("strong").textContent=`Question ${i+1}`);}
function fillSelect(id, rows, placeholder) {
  $(id).innerHTML=`<option value="">${placeholder}</option>`+rows.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("");
}
async function loadAdminData() {
  if(!db||!adminUser)return;
  $("adminQuizList").innerHTML='<div class="empty-state">Loading quizzes…</div>';
  const [{data:classes,error:ce},{data:subjects,error:se},{data:quizzes,error:qe},{data:attempts,error:ae}] = await Promise.all([
    db.from("classes").select("id,name").order("sort_order"),
    db.from("subjects").select("id,name").order("name"),
    db.from("quizzes").select("id,title,description,published,duration_minutes,created_at,classes(name),subjects(name)").order("created_at",{ascending:false}),
    db.from("attempts").select("id,score,total_questions,submitted_at,profiles(username,display_name),quizzes(title)").eq("status","submitted").order("submitted_at",{ascending:false}).limit(15)
  ]);
  if(ce||se||qe||ae){$("adminQuizList").innerHTML='<div class="empty-state">Could not load admin data. Check that the admin-only SQL policies have been applied.</div>';return;}
  fillSelect("quizClass",classes||[],"Choose class"); fillSelect("quizSubject",subjects||[],"Choose subject");
  $("adminQuizCount").textContent=(quizzes||[]).length;
  $("adminPublishedCount").textContent=(quizzes||[]).filter(q=>q.published).length;
  $("adminAttemptCount").textContent=(attempts||[]).length;
  renderAdminQuizzes(quizzes||[]); renderAdminResults(attempts||[]);
}
function renderAdminQuizzes(quizzes) {
  if(!quizzes.length){$("adminQuizList").innerHTML='<div class="empty-state">No quizzes yet. Create your first quiz.</div>';return;}
  $("adminQuizList").innerHTML=quizzes.map(q=>`<article class="admin-quiz-item"><div class="admin-quiz-title"><strong>${esc(q.title)}</strong><span class="status-pill ${q.published?"published":"draft"}">${q.published?"Published":"Draft"}</span></div><p>${esc(q.classes?.name||"Class")} · ${esc(q.subjects?.name||"Subject")} · ${q.duration_minutes} min</p><div class="admin-item-actions"><button class="outline-btn" data-toggle="${q.id}" data-published="${q.published}">${q.published?"Unpublish":"Publish"}</button><button class="outline-btn danger" data-delete="${q.id}">Delete</button></div></article>`).join("");
  $("adminQuizList").querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",()=>togglePublished(btn.dataset.toggle,btn.dataset.published==="true")));
  $("adminQuizList").querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>deleteQuiz(btn.dataset.delete)));
}
function renderAdminResults(rows) {
  if(!rows.length){$("adminResults").innerHTML='<div class="empty-state">No submitted attempts yet.</div>';return;}
  $("adminResults").innerHTML=`<div class="result-table-wrap"><table class="result-table"><thead><tr><th>Student</th><th>Quiz</th><th>Score</th><th>Date</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.profiles?.display_name||a.profiles?.username||"Student")}</td><td>${esc(a.quizzes?.title||"Quiz")}</td><td>${a.score}/${a.total_questions}</td><td>${new Date(a.submitted_at).toLocaleDateString()}</td></tr>`).join("")}</tbody></table></div>`;
}
async function saveQuiz(e) {
  e.preventDefault(); if(!adminUser)return;
  const title=$("quizTitle").value.trim(), description=$("quizDescription").value.trim(), class_id=$("quizClass").value, subject_id=$("quizSubject").value, duration_minutes=Number($("quizDuration").value), publish=$("publishNow").checked;
  const cards=[...$("questionEditor").querySelectorAll(".question-edit-card")];
  if(!cards.length)return status("adminFormMessage","Add at least one question before saving.");
  if(!class_id||!subject_id)return status("adminFormMessage","Choose a class and subject.");
  const questions=cards.map(card=>({question_text:card.querySelector(".question-text").value.trim(),options:[...card.querySelectorAll(".question-option")].map(i=>i.value.trim()),correct_option:Number(card.querySelector(".correct-option").value)}));
  if(questions.some(q=>!q.question_text||q.options.some(o=>!o)))return status("adminFormMessage","Complete each question and all four options.");
  if(questions.some(q=>new Set(q.options).size!==q.options.length))return status("adminFormMessage","Each question should have four different options.");
  const btn=$("saveQuizBtn");btn.disabled=true;btn.textContent="Saving quiz…";status("adminFormMessage","");
  let quizId=null;
  try{
    const {data:quiz,error}=await db.from("quizzes").insert({title,description,class_id,subject_id,duration_minutes,published:false,created_by:adminUser.id}).select("id").single();
    if(error)throw error;quizId=quiz.id;
    for(let i=0;i<questions.length;i++){
      const q=questions[i];
      const {data:created,error:qError}=await db.from("quiz_questions").insert({quiz_id:quizId,question_text:q.question_text,options:q.options,sort_order:i+1}).select("id").single();
      if(qError)throw qError;
      const {error:keyError}=await db.from("quiz_answer_keys").insert({question_id:created.id,correct_option:q.correct_option});
      if(keyError)throw keyError;
    }
    if(publish){const {error:pubError}=await db.from("quizzes").update({published:true}).eq("id",quizId);if(pubError)throw pubError;}
    $("createQuizForm").reset();$("quizDuration").value=10;$("questionEditor").innerHTML="";questionCounter=0;addQuestionEditor();
    status("adminFormMessage",publish?"Quiz saved and published successfully.":"Quiz saved as a draft. Publish it from the quiz list when ready.",false);
    await loadAdminData();
  }catch(err){
    // Keep partially created quiz unpublished if any operation fails.
    if(quizId) await db.from("quizzes").update({published:false}).eq("id",quizId);
    status("adminFormMessage","Could not save quiz. Check database policies and try again. "+(err.message||""));
  }finally{btn.disabled=false;btn.innerHTML='Save quiz <span>→</span>';}
}
async function togglePublished(id, currentlyPublished) {
  const {error}=await db.from("quizzes").update({published:!currentlyPublished}).eq("id",id);
  if(error){alert("Could not update publication status. Check admin database policies.");return;}
  await loadAdminData();
}
async function deleteQuiz(id) {
  if(!confirm("Delete this quiz and its questions? Existing attempts may prevent deletion. This cannot be undone."))return;
  const {error}=await db.from("quizzes").delete().eq("id",id);
  if(error){alert("Could not delete this quiz. It may have existing attempts. Unpublish it instead.");return;}
  await loadAdminData();
}
addQuestionEditor();
