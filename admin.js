
const $ = id => document.getElementById(id);

const configReady =
  window.SUPABASE_URL &&
  !window.SUPABASE_URL.includes("YOUR-PROJECT") &&
  window.SUPABASE_ANON_KEY &&
  !window.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");

const db = configReady && window.supabase
  ? window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    )
  : null;

let adminUser = null;
let questionCounter = 0;
let editingQuizId = null;

let studentRows = [];
let classRows = [];

$("year").textContent = new Date().getFullYear();

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function status(id, message, error = true) {
  const element = $(id);

  if (!element) {
    console.warn(`Status element not found: ${id}`, message);
    return;
  }

  element.textContent = message;
  element.style.color = error ? "#b42318" : "#28753b";
}

function usernameEmail(username) {
  return `${username.trim().toLowerCase()}@students.schoolquiz.app`;
}

function setFormMode(editing) {
  const title = $("adminFormTitle");
  const description = $("adminFormDescription");
  const saveButton = $("saveQuizBtn");
  const cancelButton = $("cancelEditBtn");

  if (title) {
    title.textContent = editing ? "Edit quiz" : "Create a quiz";
  }

  if (description) {
    description.textContent = editing
      ? "Update the quiz details and questions below."
      : "Create a quiz and add its questions.";
  }

  if (saveButton) {
    saveButton.innerHTML = editing
      ? "Update quiz <span>→</span>"
      : "Save quiz <span>→</span>";
  }

  if (cancelButton) {
    cancelButton.classList.toggle("hidden", !editing);
  }
}

function resetQuizForm() {
  editingQuizId = null;

  $("createQuizForm").reset();
  $("quizDuration").value = 10;
  $("questionEditor").innerHTML = "";

  questionCounter = 0;

  addQuestionEditor();
  setFormMode(false);
  status("adminFormMessage", "", false);
}

// --------------------------------------------------
// ADMIN LOGIN
// --------------------------------------------------

$("adminLoginForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!db) {
    return status(
      "adminLoginMessage",
      "Configure your Supabase URL and key in config.js first."
    );
  }

  const username = $("adminUsername").value.trim().toLowerCase();
  const password = $("adminPassword").value;

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return status(
      "adminLoginMessage",
      "Enter the administrator username provided by the database owner."
    );
  }

  const button = event.currentTarget.querySelector(
    'button[type="submit"]'
  );

  button.disabled = true;
  button.textContent = "Signing in…";

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email: usernameEmail(username),
      password
    });

    if (error) throw error;

    const {
      data: profile,
      error: profileError
    } = await db
      .from("profiles")
      .select("id,username,display_name,role")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile || profile.role !== "admin") {
      await db.auth.signOut();

      throw new Error(
        "This account does not have administrator permission."
      );
    }

    adminUser = data.user;

    $("adminLoginView").classList.add("hidden");
    $("adminView").classList.remove("hidden");

    await loadAdminData();
  } catch (error) {
    console.error("Admin login failed:", error);

    status(
      "adminLoginMessage",
      error.message ===
        "This account does not have administrator permission."
        ? error.message
        : "Sign-in failed. Check the administrator username and password."
    );
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in to admin <span>→</span>';
  }
});

$("adminLogoutBtn").addEventListener("click", async () => {
  if (db) {
    await db.auth.signOut();
  }

  adminUser = null;
  editingQuizId = null;

  $("adminView").classList.add("hidden");
  $("adminLoginView").classList.remove("hidden");
  $("adminLoginForm").reset();

  resetQuizForm();
});

$("refreshAdminBtn").addEventListener("click", loadAdminData);

$("addQuestionBtn").addEventListener("click", () => {
  addQuestionEditor();
});

$("createQuizForm").addEventListener("submit", saveQuiz);

// --------------------------------------------------
// STUDENT FORM EVENT LISTENERS
// --------------------------------------------------

if ($("createStudentForm")) {
  $("createStudentForm").addEventListener(
    "submit",
    createStudentAccount
  );
}

if ($("refreshStudentsBtn")) {
  $("refreshStudentsBtn").addEventListener(
    "click",
    () => loadStudentDirectory()
  );
}

if ($("studentSearch")) {
  $("studentSearch").addEventListener(
    "input",
    renderStudentDirectory
  );
}

if ($("studentClassFilter")) {
  $("studentClassFilter").addEventListener(
    "change",
    renderStudentDirectory
  );
}

if ($("resetStudentFormBtn")) {
  $("resetStudentFormBtn").addEventListener("click", () => {
    if ($("createStudentForm")) {
      $("createStudentForm").reset();
    }

    status("studentFormMessage", "", false);
  });
}

if ($("cancelEditBtn")) {
  $("cancelEditBtn").addEventListener("click", () => {
    resetQuizForm();

    status(
      "adminFormMessage",
      "Editing cancelled.",
      false
    );
  });
}

// --------------------------------------------------
// QUIZ QUESTION EDITOR
// --------------------------------------------------

function addQuestionEditor(question = null) {
  const number = ++questionCounter;
  const wrapper = document.createElement("div");

  wrapper.className = "question-edit-card";

  if (question?.id) {
    wrapper.dataset.questionId = question.id;
  }

  const options = Array.isArray(question?.options)
    ? question.options
    : ["", "", "", ""];

  wrapper.innerHTML = `
    <div class="question-builder-heading">
      <strong>Question ${number}</strong>
      <button type="button" class="remove-question">Remove</button>
    </div>

    <label>Question text</label>
    <textarea class="question-text"
      rows="2" maxlength="1000" required
      placeholder="Type the question">${esc(question?.question_text || "")}</textarea>

    <div class="options-grid">
      ${[0, 1, 2, 3].map(index => `
        <div>
          <label>Option ${String.fromCharCode(65 + index)}</label>
          <input class="question-option"
            required maxlength="250"
            placeholder="Answer option ${index + 1}"
            value="${esc(options[index] || "")}">
        </div>
      `).join("")}
    </div>

    <label>Correct answer</label>
    <select class="correct-option">
      ${[0, 1, 2, 3].map(index => `
        <option value="${index}"
          ${Number(question?.correct_option ?? 0) === index ? "selected" : ""}>
          Option ${String.fromCharCode(65 + index)}
        </option>
      `).join("")}
    </select>
  `;

  wrapper.querySelector(".remove-question").addEventListener("click", () => {
    wrapper.remove();
    renumberQuestions();
  });

  $("questionEditor").appendChild(wrapper);
}

function renumberQuestions() {
  [...$("questionEditor").children].forEach((element, index) => {
    element.querySelector("strong").textContent =
      `Question ${index + 1}`;
  });
}

function fillSelect(id, rows, placeholder) {
  const element = $(id);

  if (!element) return;

  element.innerHTML =
    `<option value="">${esc(placeholder)}</option>` +
    rows.map(row =>
      `<option value="${esc(row.id)}">${esc(row.name)}</option>`
    ).join("");
}

// --------------------------------------------------
// LOAD ADMIN DASHBOARD DATA
// --------------------------------------------------

async function loadAdminData() {
  if (!db || !adminUser) return;

  $("adminQuizList").innerHTML =
    '<div class="empty-state">Loading quizzes…</div>';

  try {
    const [
      { data: classes, error: classError },
      { data: subjects, error: subjectError },
      { data: quizzes, error: quizError },
      { data: attempts, error: attemptError }
    ] = await Promise.all([
      db.from("classes")
        .select("id,name")
        .order("sort_order"),

      db.from("subjects")
        .select("id,name")
        .order("name"),

      db.from("quizzes")
        .select("id,title,description,published,duration_minutes,created_at,classes(name),subjects(name)")
        .order("created_at", { ascending: false }),

      db.from("attempts")
        .select("id,score,total_questions,submitted_at,profiles(username,display_name),quizzes(title)")
        .eq("status", "submitted")
        .order("submitted_at", { ascending: false })
        .limit(15)
    ]);

    if (classError) throw classError;
    if (subjectError) throw subjectError;
    if (quizError) throw quizError;
    if (attemptError) throw attemptError;

    fillSelect("quizClass", classes || [], "Choose class");
    fillSelect("quizSubject", subjects || [], "Choose subject");

    classRows = classes || [];

    populateStudentClassOptions(classRows);

    await loadStudentDirectory(classRows);

    $("adminQuizCount").textContent = (quizzes || []).length;

    $("adminPublishedCount").textContent =
      (quizzes || []).filter(quiz => quiz.published).length;

    $("adminAttemptCount").textContent = (attempts || []).length;

    renderAdminQuizzes(quizzes || []);
    renderAdminResults(attempts || []);
  } catch (error) {
    console.error("Load admin data failed:", error);

    $("adminQuizList").innerHTML =
      '<div class="empty-state">Could not load admin data. Check your Supabase connection and database policies.</div>';
  }
}

// --------------------------------------------------
// RENDER QUIZZES
// --------------------------------------------------

function renderAdminQuizzes(quizzes) {
  if (!quizzes.length) {
    $("adminQuizList").innerHTML =
      '<div class="empty-state">No quizzes yet. Create your first quiz.</div>';
    return;
  }

  $("adminQuizList").innerHTML = quizzes.map(quiz => `
    <article class="admin-quiz-item">
      <div class="admin-quiz-title">
        <strong>${esc(quiz.title)}</strong>
        <span class="status-pill ${quiz.published ? "published" : "draft"}">
          ${quiz.published ? "Published" : "Draft"}
        </span>
      </div>

      <p>
        ${esc(quiz.classes?.name || "Class")} ·
        ${esc(quiz.subjects?.name || "Subject")} ·
        ${quiz.duration_minutes} min
      </p>

      <div class="admin-item-actions">
        <button class="outline-btn" data-edit="${esc(quiz.id)}">
          Edit quiz
        </button>

        <button class="outline-btn"
          data-toggle="${esc(quiz.id)}"
          data-published="${quiz.published}">
          ${quiz.published ? "Unpublish" : "Publish"}
        </button>

        <button class="outline-btn danger" data-delete="${esc(quiz.id)}">
          Delete
        </button>
      </div>
    </article>
  `).join("");

  $("adminQuizList").querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => editQuiz(button.dataset.edit));
  });

  $("adminQuizList").querySelectorAll("[data-toggle]").forEach(button => {
    button.addEventListener("click", () =>
      togglePublished(
        button.dataset.toggle,
        button.dataset.published === "true"
      )
    );
  });

  $("adminQuizList").querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", () =>
      deleteQuiz(button.dataset.delete)
    );
  });
}

// --------------------------------------------------
// RENDER RESULTS
// --------------------------------------------------

function renderAdminResults(rows) {
  if (!rows.length) {
    $("adminResults").innerHTML =
      '<div class="empty-state">No submitted attempts yet.</div>';
    return;
  }

  $("adminResults").innerHTML = `
    <div class="result-table-wrap">
      <table class="result-table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Quiz</th>
            <th>Score</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(attempt => `
            <tr>
              <td>${esc(attempt.profiles?.display_name || attempt.profiles?.username || "Student")}</td>
              <td>${esc(attempt.quizzes?.title || "Quiz")}</td>
              <td>${attempt.score}/${attempt.total_questions}</td>
              <td>${attempt.submitted_at
                ? new Date(attempt.submitted_at).toLocaleDateString()
                : "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// --------------------------------------------------
// EDIT QUIZ
// --------------------------------------------------

async function editQuiz(quizId) {
  if (!adminUser) return;

  status("adminFormMessage", "Loading quiz…", false);

  try {
    const { data: quiz, error: quizError } = await db
      .from("quizzes")
      .select("id,title,description,class_id,subject_id,duration_minutes,published")
      .eq("id", quizId)
      .single();

    if (quizError) throw quizError;

    const {
      data: questionRows,
      error: questionError
    } = await db
      .from("quiz_questions")
      .select("id,question_text,options,sort_order")
      .eq("quiz_id", quizId)
      .order("sort_order");

    if (questionError) throw questionError;

    const questionIds = (questionRows || []).map(question => question.id);
    let answerKeys = [];

    if (questionIds.length) {
      const { data, error } = await db
        .from("quiz_answer_keys")
        .select("question_id,correct_option")
        .in("question_id", questionIds);

      if (error) throw error;

      answerKeys = data || [];
    }

    const answerMap = new Map(
      answerKeys.map(key => [key.question_id, key.correct_option])
    );

    editingQuizId = quiz.id;

    $("quizTitle").value = quiz.title || "";
    $("quizDescription").value = quiz.description || "";
    $("quizClass").value = quiz.class_id || "";
    $("quizSubject").value = quiz.subject_id || "";
    $("quizDuration").value = quiz.duration_minutes || 10;
    $("publishNow").checked = Boolean(quiz.published);

    $("questionEditor").innerHTML = "";
    questionCounter = 0;

    (questionRows || []).forEach(question => {
      addQuestionEditor({
        ...question,
        correct_option: answerMap.get(question.id) ?? 0
      });
    });

    if (!questionRows?.length) {
      addQuestionEditor();
    }

    setFormMode(true);

    status(
      "adminFormMessage",
      "Quiz loaded. Make your changes and select Update quiz.",
      false
    );

    $("createQuizForm").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    console.error("Edit quiz failed:", error);

    status(
      "adminFormMessage",
      "Could not load this quiz for editing. Check the quiz and answer-key database policies."
    );
  }
}

// --------------------------------------------------
// SAVE QUIZ
// --------------------------------------------------

async function saveQuiz(event) {
  event.preventDefault();

  if (!adminUser) return;

  const wasEditing = Boolean(editingQuizId);

  const title = $("quizTitle").value.trim();
  const description = $("quizDescription").value.trim();
  const class_id = $("quizClass").value;
  const subject_id = $("quizSubject").value;
  const duration_minutes = Number($("quizDuration").value);
  const publish = $("publishNow").checked;

  const cards = [
    ...$("questionEditor").querySelectorAll(".question-edit-card")
  ];

  if (!title) {
    return status("adminFormMessage", "Enter a quiz title.");
  }

  if (!cards.length) {
    return status("adminFormMessage", "Add at least one question before saving.");
  }

  if (!class_id || !subject_id) {
    return status("adminFormMessage", "Choose a class and subject.");
  }

  if (!Number.isFinite(duration_minutes) || duration_minutes < 1) {
    return status("adminFormMessage", "Enter a valid quiz duration.");
  }

  const questions = cards.map(card => ({
    id: card.dataset.questionId || null,
    question_text: card.querySelector(".question-text").value.trim(),
    options: [...card.querySelectorAll(".question-option")]
      .map(input => input.value.trim()),
    correct_option: Number(card.querySelector(".correct-option").value)
  }));

  if (questions.some(question =>
    !question.question_text ||
    question.options.length !== 4 ||
    question.options.some(option => !option)
  )) {
    return status(
      "adminFormMessage",
      "Complete every question and all four answer options."
    );
  }

  if (questions.some(question =>
    new Set(question.options).size !== question.options.length
  )) {
    return status(
      "adminFormMessage",
      "Each question must have four different answer options."
    );
  }

  const button = $("saveQuizBtn");
  button.disabled = true;
  button.textContent = wasEditing ? "Updating quiz…" : "Saving quiz…";

  status("adminFormMessage", "", false);

  let quizId = editingQuizId;
  let createdNewQuiz = false;

  try {
    const quizDetails = {
      title,
      description,
      class_id,
      subject_id,
      duration_minutes,
      published: false
    };

    if (editingQuizId) {
      const { error } = await db
        .from("quizzes")
        .update(quizDetails)
        .eq("id", editingQuizId);

      if (error) throw error;
    } else {
      const { data, error } = await db
        .from("quizzes")
        .insert({
          ...quizDetails,
          created_by: adminUser.id
        })
        .select("id")
        .single();

      if (error) throw error;

      quizId = data.id;
      createdNewQuiz = true;
    }

    const {
      data: existingRows,
      error: existingError
    } = await db
      .from("quiz_questions")
      .select("id")
      .eq("quiz_id", quizId);

    if (existingError) throw existingError;

    const existingIds = new Set(
      (existingRows || []).map(row => row.id)
    );

    const retainedIds = new Set();

    for (let index = 0; index < questions.length; index++) {
      const question = questions[index];

      const questionData = {
        quiz_id: quizId,
        question_text: question.question_text,
        options: question.options,
        sort_order: index + 1
      };

      let questionId = question.id;

      if (questionId && existingIds.has(questionId)) {
        const { error } = await db
          .from("quiz_questions")
          .update(questionData)
          .eq("id", questionId)
          .eq("quiz_id", quizId);

        if (error) throw error;
      } else {
        const { data, error } = await db
          .from("quiz_questions")
          .insert(questionData)
          .select("id")
          .single();

        if (error) throw error;

        questionId = data.id;
      }

      retainedIds.add(questionId);

      const { error: keyError } = await db
        .from("quiz_answer_keys")
        .upsert(
          {
            question_id: questionId,
            correct_option: question.correct_option
          },
          { onConflict: "question_id" }
        );

      if (keyError) throw keyError;
    }

    const removedIds = [...existingIds].filter(
      id => !retainedIds.has(id)
    );

    if (removedIds.length) {
      const { error: deleteKeysError } = await db
        .from("quiz_answer_keys")
        .delete()
        .in("question_id", removedIds);

      if (deleteKeysError) throw deleteKeysError;

      const { error: deleteQuestionsError } = await db
        .from("quiz_questions")
        .delete()
        .in("id", removedIds)
        .eq("quiz_id", quizId);

      if (deleteQuestionsError) {
        throw new Error(
          "Could not remove one or more questions. The quiz may have existing attempts linked to them. " +
          deleteQuestionsError.message
        );
      }
    }

    const { error: publishError } = await db
      .from("quizzes")
      .update({ published: publish })
      .eq("id", quizId);

    if (publishError) throw publishError;

    resetQuizForm();

    status(
      "adminFormMessage",
      wasEditing
        ? "Quiz updated successfully."
        : publish
          ? "Quiz saved and published successfully."
          : "Quiz saved as a draft.",
      false
    );

    await loadAdminData();
  } catch (error) {
    console.error("Save quiz failed:", error);

    if (createdNewQuiz && quizId) {
      await db
        .from("quizzes")
        .update({ published: false })
        .eq("id", quizId);
    }

    status(
      "adminFormMessage",
      "Could not save all changes. " +
      (error.message || "Check your Supabase policies.")
    );
  } finally {
    button.disabled = false;
    setFormMode(Boolean(editingQuizId));
  }
}

// --------------------------------------------------
// PUBLISH OR UNPUBLISH QUIZ
// --------------------------------------------------

async function togglePublished(id, currentlyPublished) {
  const { error } = await db
    .from("quizzes")
    .update({ published: !currentlyPublished })
    .eq("id", id);

  if (error) {
    console.error("Publish status update failed:", error);

    alert(
      "Could not update publication status. Check admin database policies."
    );

    return;
  }

  await loadAdminData();
}

// --------------------------------------------------
// DELETE QUIZ
// --------------------------------------------------

async function deleteQuiz(id) {
  if (!confirm(
    "Delete this quiz and its questions? Existing attempts may prevent deletion. This cannot be undone."
  )) {
    return;
  }

  const { error } = await db
    .from("quizzes")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Delete quiz failed:", error);

    alert(
      "Could not delete this quiz. It may have existing attempts. Unpublish it instead."
    );

    return;
  }

  if (editingQuizId === id) {
    resetQuizForm();
  }

  await loadAdminData();
}

// --------------------------------------------------
// STUDENT CLASS DROPDOWNS
// --------------------------------------------------

function populateStudentClassOptions(classes) {
  const studentClass = $("studentClass");
  const classFilter = $("studentClassFilter");

  if (studentClass) {
    const previousClass = studentClass.value;

    studentClass.innerHTML =
      '<option value="">Select a class</option>' +
      classes.map(row =>
        `<option value="${esc(row.id)}">${esc(row.name)}</option>`
      ).join("");

    if (classes.some(row => String(row.id) === previousClass)) {
      studentClass.value = previousClass;
    }
  }

  if (classFilter) {
    const previousFilter = classFilter.value;

    classFilter.innerHTML =
      '<option value="">All classes</option>' +
      classes.map(row =>
        `<option value="${esc(row.id)}">${esc(row.name)}</option>`
      ).join("");

    if (classes.some(row => String(row.id) === previousFilter)) {
      classFilter.value = previousFilter;
    }
  }
}

// --------------------------------------------------
// CREATE STUDENT ACCOUNT
// --------------------------------------------------

async function createStudentAccount(event) {
  event.preventDefault();

  if (!db || !adminUser) {
    return status(
      "studentFormMessage",
      "Please sign in as an administrator before creating student accounts."
    );
  }

  const display_name =
    $("studentDisplayName").value.trim();

  const username =
    $("studentUsername").value.trim().toLowerCase();

  const class_id = $("studentClass").value;
  const password = $("studentPassword").value;

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    return status(
      "studentFormMessage",
      "Username must be 3–40 characters and contain only letters, numbers, dots, underscores, or hyphens."
    );
  }

  if (!display_name) {
    return status(
      "studentFormMessage",
      "Enter the student's full name."
    );
  }

  if (!class_id) {
    return status(
      "studentFormMessage",
      "Please select the student's class."
    );
  }

  if (password.length < 8) {
    return status(
      "studentFormMessage",
      "Password must contain at least 8 characters."
    );
  }

  const button = $("createStudentBtn");

  if (!button) {
    return status(
      "studentFormMessage",
      "Create Student button not found. Check the button ID in admin.html."
    );
  }

  button.disabled = true;
  button.textContent = "Creating account…";

  status("studentFormMessage", "", false);

  try {
    console.log("Calling create-student-account Edge Function.");

    const { data, error } = await db.functions.invoke(
      "create-student-account",
      {
        body: {
          username,
          display_name,
          class_id,
          password
        }
      }
    );

    // Read useful error details from the Edge Function response.
    if (error) {
      let message =
        error.message || "Could not create the student account.";

      try {
        const response = error.context;

        if (response && typeof response.json === "function") {
          const result = await response.json();

          if (result?.error) {
            message = result.error;
          } else if (result?.message) {
            message = result.message;
          }
        }
      } catch (_) {
        // Keep the original error message.
      }

      throw new Error(message);
    }

    console.log("Student creation function response:", data);

    // Do not report success unless the Edge Function confirms it.
    if (!data || data.success !== true) {
      throw new Error(
        data?.error ||
        data?.message ||
        "The server did not confirm account creation. Check the Edge Function logs."
      );
    }

    // Clear the form only after confirmed success.
    $("createStudentForm").reset();

    status(
      "studentFormMessage",
      `Student account created successfully for ${display_name}.`,
      false
    );

    // Refresh the student list after creation.
    await loadStudentDirectory();

  } catch (error) {
    console.error("Create student account failed:", error);

    status(
      "studentFormMessage",
      error.message ||
      "Account creation failed. Check the Edge Function and database policies."
    );

  } finally {
    button.disabled = false;
    button.innerHTML =
      'Create student account <span>→</span>';
  }
}

// --------------------------------------------------
// LOAD STUDENT DIRECTORY
// --------------------------------------------------

async function loadStudentDirectory(classes = null) {
  const list = $("adminStudentList");

  if (!list || !db || !adminUser) return;

  if (Array.isArray(classes)) {
    classRows = classes;
    populateStudentClassOptions(classRows);
  }

  list.innerHTML =
    '<div class="empty-state">Loading student accounts…</div>';

  try {
    const { data, error } = await db
      .from("profiles")
      .select("id,username,display_name,class_id,role")
      .eq("role", "student")
      .order("username", { ascending: true });

    if (error) throw error;

    studentRows = data || [];

    renderStudentDirectory();

    status(
      "studentListMessage",
      `${studentRows.length} student account${studentRows.length === 1 ? "" : "s"} found.`,
      false
    );

  } catch (error) {
    console.error("Load student directory failed:", error);

    list.innerHTML =
      '<div class="empty-state">Could not load students. Check the profiles SELECT policy for administrators.</div>';

    status(
      "studentListMessage",
      "Student directory could not be loaded. Check your Supabase connection and RLS policies."
    );
  }
}

// --------------------------------------------------
// SEARCH AND DISPLAY STUDENTS
// --------------------------------------------------

function renderStudentDirectory() {
  const list = $("adminStudentList");

  if (!list) return;

  const searchTerm =
    ($("studentSearch")?.value || "")
      .trim()
      .toLowerCase();

  const classFilter =
    $("studentClassFilter")?.value || "";

  const classNameById = new Map(
    classRows.map(row => [
      String(row.id),
      row.name
    ])
  );

  const filtered = studentRows.filter(student => {
    const name =
      (student.display_name || "").toLowerCase();

    const username =
      (student.username || "").toLowerCase();

    const matchesSearch =
      !searchTerm ||
      name.includes(searchTerm) ||
      username.includes(searchTerm);

    const matchesClass =
      !classFilter ||
      String(student.class_id || "") === classFilter;

    return matchesSearch && matchesClass;
  });

  if (!filtered.length) {
    list.innerHTML =
      '<div class="empty-state">No students match your search or class filter.</div>';
    return;
  }

  list.innerHTML = filtered.map(student => `
    <article class="admin-quiz-item">
      <div class="admin-quiz-title">
        <strong>
          ${esc(student.display_name || student.username || "Student")}
        </strong>

        <span class="status-pill published">Student</span>
      </div>

      <p>
        Username:
        <strong>${esc(student.username || "—")}</strong>
        <br>
        Class:
        ${esc(
          classNameById.get(String(student.class_id)) ||
          "Not assigned"
        )}
      </p>
    </article>
  `).join("");
}

// --------------------------------------------------
// INITIALIZE
// --------------------------------------------------

addQuestionEditor();
setFormMode(false);
