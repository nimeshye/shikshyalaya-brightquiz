# Shikshyalaya Nepal BrightQuiz

Responsive student quiz portal with a separate admin-only quiz management page, built with HTML/CSS/JavaScript and Supabase, deployable on Vercel.

## Project files

- `index.html`, `style.css`, `app.js`: student site
- `admin.html`, `admin.js`: admin-only quiz builder, publication controls, recent results
- `config.js`: Supabase project URL and publishable/anon key
- `schema.sql`: database tables, RLS policies, server-side scoring function, Classes 1–10 and subject seeds
- `vercel.json`: deployment headers

## 1. Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run `schema.sql` in a fresh project.
3. In Project Settings/API, copy the Project URL and publishable key (or legacy anon key) into `config.js`.
4. Never place the `service_role` key in browser code.

## 2. Create the administrator

1. In Supabase Authentication → Users, create an Auth user with email alias `schooladmin@students.schoolquiz.app` and a strong password. This website lets the admin type only `schooladmin` as the username.
2. Copy the user's UUID.
3. In SQL Editor, run this, replacing the UUID and username:

```sql
insert into public.profiles(id, username, display_name, class_id, role)
values ('PASTE-AUTH-USER-UUID'::uuid, 'schooladmin', 'Shikshyalaya Nepal Admin', null, 'admin');
```

Only an owner/database administrator should grant `role='admin'`. Do not expose admin account creation to the public website.

## 3. Create students

For each student, create a Supabase Auth user using an alias such as `student01@students.schoolquiz.app` and a temporary password. Copy that user's Auth UUID and add a matching profile, assigning a class:

```sql
insert into public.profiles(id, username, display_name, class_id, role)
select 'PASTE-AUTH-USER-UUID'::uuid, 'student01', 'Student One', c.id, 'student'
from public.classes c where c.name='Class 5';
```

Students sign in at `/` with username `student01` and their password. The internal alias domain is just an identifier used by the app; no email is sent by this sign-in method. Use a secure password distribution and reset process for real students.

## 4. Use the admin dashboard

Open `/admin.html`, sign in as the administrator, then:
- choose a class and subject,
- enter title, description and time limit,
- add questions and four answer options,
- select the correct option,
- save as a draft or publish immediately,
- publish/unpublish quizzes and review recent results.

The database policies enforce admin-only quiz creation and answer-key access. Students can only read published quizzes and questions, and score calculation runs inside the database function.

## 5. Test locally

Use VS Code with Live Server to serve `index.html`; test `/admin.html` separately. Test using one student account and one admin account. Confirm a student cannot load answer keys or write quiz data.

## 6. Deploy to Vercel

1. Upload all files to GitHub.
2. Import the repository at https://vercel.com.
3. Framework preset: Other. Build command: blank. Output directory: `.`.
4. Deploy. Ensure `config.js` contains the project URL and publishable key before pushing.
5. For password recovery flows later, configure the deployed domain in Supabase Auth URL settings.

## Security and known limitations

- Keep RLS enabled and never expose the service role key.
- Admin role assignment must be done by the database owner.
- Admin page checks the profile role for usability; RLS is the actual security boundary.
- This version does not yet implement server-enforced timers, retake limits, password reset UI, detailed analytics, or student management UI.
- Existing attempts may prevent deleting a quiz due to foreign-key references; unpublish it instead.
- Do not use real student information until your school has tested access policies and established consent, password management and data retention practices.
