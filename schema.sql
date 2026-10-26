-- Shikshyalaya Nepal BrightQuiz schema
-- Run in Supabase SQL Editor for a fresh project.
-- Do not put service_role credentials in frontend code.

create extension if not exists pgcrypto;

create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0
);
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  class_id uuid references public.classes(id),
  role text not null default 'student' check (role in ('student','admin')),
  created_at timestamptz not null default now()
);
create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  class_id uuid not null references public.classes(id),
  subject_id uuid not null references public.subjects(id),
  duration_minutes int not null default 10 check (duration_minutes between 1 and 180),
  published boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 8),
  sort_order int not null default 0
);
create table if not exists public.quiz_answer_keys (
  question_id uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_option int not null check (correct_option >= 0)
);
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id),
  quiz_id uuid not null references public.quizzes(id),
  score int not null default 0,
  total_questions int not null default 0,
  status text not null default 'submitted' check (status in ('submitted')),
  submitted_at timestamptz not null default now()
);
create table if not exists public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.quiz_questions(id),
  selected_option int not null,
  is_correct boolean not null,
  unique(attempt_id, question_id)
);

alter table public.classes enable row level security;
alter table public.subjects enable row level security;
alter table public.profiles enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.quiz_answer_keys enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;

-- Helper avoids recursive RLS checks when checking the current profile's role.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Remove old starter policies if this schema is being applied over an earlier version.
drop policy if exists "signed in users read classes" on public.classes;
drop policy if exists "signed in users read subjects" on public.subjects;
drop policy if exists "users read own profile or staff read profiles" on public.profiles;
drop policy if exists "students read published quizzes" on public.quizzes;
drop policy if exists "read questions for published quizzes" on public.quiz_questions;
drop policy if exists "students read own attempts staff read all" on public.attempts;
drop policy if exists "students read own answers staff read all" on public.attempt_answers;
drop policy if exists "admin manages classes" on public.classes;
drop policy if exists "admin manages subjects" on public.subjects;
drop policy if exists "read own profile or admin reads profiles" on public.profiles;
drop policy if exists "read published quizzes or admin reads all" on public.quizzes;
drop policy if exists "read published questions or admin reads all" on public.quiz_questions;
drop policy if exists "admin manages quizzes" on public.quizzes;
drop policy if exists "admin manages questions" on public.quiz_questions;
drop policy if exists "admin manages answer keys" on public.quiz_answer_keys;
drop policy if exists "read own attempts or admin reads all" on public.attempts;
drop policy if exists "read own attempt answers or admin reads all" on public.attempt_answers;

create policy "signed in users read classes" on public.classes for select to authenticated using (true);
create policy "admin manages classes" on public.classes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "signed in users read subjects" on public.subjects for select to authenticated using (true);
create policy "admin manages subjects" on public.subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read own profile or admin reads profiles" on public.profiles for select to authenticated using (id=auth.uid() or public.is_admin());
create policy "admin updates profiles" on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read published quizzes or admin reads all" on public.quizzes for select to authenticated using (published=true or public.is_admin());
create policy "admin manages quizzes" on public.quizzes for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read published questions or admin reads all" on public.quiz_questions for select to authenticated using (exists(select 1 from public.quizzes q where q.id=quiz_id and q.published=true) or public.is_admin());
create policy "admin manages questions" on public.quiz_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin manages answer keys" on public.quiz_answer_keys for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read own attempts or admin reads all" on public.attempts for select to authenticated using (student_id=auth.uid() or public.is_admin());
create policy "read own attempt answers or admin reads all" on public.attempt_answers for select to authenticated
using (exists(select 1 from public.attempts a where a.id=attempt_id and a.student_id=auth.uid()) or public.is_admin());

-- Students cannot SELECT answer keys. Admin-only RLS policy is the only access path.
-- Quiz creation and answer keys are restricted to the designated admin role.

create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  v_student uuid := auth.uid();
  v_attempt uuid;
  v_score int := 0;
  v_total int := 0;
  v_answer jsonb;
  v_question_id uuid;
  v_selected int;
  v_correct int;
  v_options jsonb;
  v_seen uuid[] := '{}';
  v_expected int;
begin
  if v_student is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.profiles where id=v_student and role='student') then raise exception 'Student account required'; end if;
  if not exists(select 1 from public.quizzes where id=p_quiz_id and published=true) then raise exception 'Quiz is not available'; end if;
  if jsonb_typeof(p_answers) <> 'array' then raise exception 'Answers must be an array'; end if;
  if jsonb_array_length(p_answers) > 200 then raise exception 'Too many answers'; end if;
  select count(*) into v_expected from public.quiz_questions where quiz_id=p_quiz_id;
  if v_expected=0 or jsonb_array_length(p_answers) <> v_expected then raise exception 'Submit one answer for every question'; end if;

  insert into public.attempts(student_id,quiz_id,score,total_questions) values(v_student,p_quiz_id,0,0) returning id into v_attempt;
  for v_answer in select value from jsonb_array_elements(p_answers) loop
    v_question_id := (v_answer->>'question_id')::uuid;
    v_selected := (v_answer->>'selected_option')::int;
    if v_question_id = any(v_seen) then raise exception 'Duplicate question answer'; end if;
    v_seen := array_append(v_seen,v_question_id);
    select ak.correct_option, qq.options into v_correct,v_options
      from public.quiz_answer_keys ak join public.quiz_questions qq on qq.id=ak.question_id
      where ak.question_id=v_question_id and qq.quiz_id=p_quiz_id;
    if not found then raise exception 'Invalid question in submission'; end if;
    if v_selected < 0 or v_selected >= jsonb_array_length(v_options) then raise exception 'Invalid selected option'; end if;
    v_total := v_total + 1;
    if v_selected=v_correct then v_score := v_score + 1; end if;
    insert into public.attempt_answers(attempt_id,question_id,selected_option,is_correct) values(v_attempt,v_question_id,v_selected,(v_selected=v_correct));
  end loop;
  update public.attempts set score=v_score,total_questions=v_total where id=v_attempt;
  return jsonb_build_object('attempt_id',v_attempt,'score',v_score,'total_questions',v_total);
end;
$$;
revoke all on function public.submit_quiz(uuid,jsonb) from public;
grant execute on function public.submit_quiz(uuid,jsonb) to authenticated;

insert into public.classes(name,sort_order) values
('Class 1',1),('Class 2',2),('Class 3',3),('Class 4',4),('Class 5',5),
('Class 6',6),('Class 7',7),('Class 8',8),('Class 9',9),('Class 10',10)
on conflict(name) do nothing;
insert into public.subjects(name) values('Mathematics'),('Science'),('English'),('Computer'),('Social')
on conflict(name) do nothing;

-- Create Auth users in Supabase Dashboard first, then create their profile.
-- ADMIN PROFILE EXAMPLE (replace both values with your own):
-- insert into public.profiles(id, username, display_name, class_id, role)
-- values ('AUTH-USER-UUID'::uuid, 'schooladmin', 'School Administrator', null, 'admin');
