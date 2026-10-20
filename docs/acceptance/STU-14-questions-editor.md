# STU-14: Questions on the sign-up form

An organiser adds questions to an event's sign-up form under **Questions**: a written answer, a checkbox, or one of several options. How people answer them is SIGN-09.

**Events:** in team «STU-14: Questions on the sign-up form», one public event open to guests, with a time and a place, «AC-1 to AC-7: Questions». For AC-7, sign up bob to it once AC-1 to AC-6 are done.

## AC-1: Three kinds of question

The studio SHALL let an organiser add questions of three kinds: a written answer, a checkbox, and one of several options.

**Test**

- **Given** the event open in the studio, with no questions
- **When** you click **Add question** three times, and pick **Written answer**, **Checkbox** and **One of several** in their type lists
- **Then** there are three numbered questions, and the one of several starts with two empty options

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-2: Required, or must be ticked

The studio SHALL let an organiser make a written answer or a choice required, and a checkbox one that must be ticked.

**Test**

- **Given** the three questions from AC-1
- **When** you look beside each type list
- **Then** the written answer and the one of several offer **Required**, and the checkbox offers **Must be ticked**, each to tick on its own

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-3: Options are added and removed

The studio SHALL let an organiser add options to a choice question and remove them, keeping at least two.

**Test**

- **Given** the one of several question from AC-1
- **When** you click **Add option**, fill in three options, and click **Remove** beside one of them
- **Then** two options are left, and their **Remove** buttons can't be clicked

**Automated:** none

## AC-4: Questions are moved

The studio SHALL let an organiser move a question up or down.

**Test**

- **Given** the three questions from AC-1
- **When** you click **↑** on the third, then **↓** on the first
- **Then** the order changes each time, and the numbers follow

**Automated:** `packages/app/e2e/specs/attendance/questions.spec.ts`

## AC-5: Questions are removed

The studio SHALL let an organiser remove a question.

**Test**

- **Given** the three questions from AC-1, and one more added with **Add question**
- **When** you click **Remove** on the one you added
- **Then** it is gone, and the others are numbered as before

**Automated:** none

## AC-6: Half-made questions can't be published

IF a question has no text, or a choice question has fewer than two options or an empty one, THEN Skjera SHALL refuse to publish the event and say why.

**Test**

- **Given** the event with a written answer that has no text
- **When** you click **Publish**
- **Then** it says «Every question needs its text»
- **When** you write the text of every question, and leave one option of the one of several empty, and click **Publish**
- **Then** it says «Choice questions need at least two options, all filled in»

**Automated:** `packages/documents/test/events/publishing.test.ts`

## AC-7: Answers keep the words they were given to

WHEN an organiser rewords a question or an option after people have answered, Skjera SHALL keep the earlier answers with the question and option as they read when answered.

**Test**

- **Given** the event published with its questions filled in, and bob signed up with an answer to each
- **When** you change the wording of a question and of the option bob picked, and click **Publish**
- **Then** under **Attendees**, bob's answers still show the old question and option

**Automated:** none
