# Teaching (教學)

教學 is a text-only feed of short owner-written passages. The list looks like posts on X: title on top, a short excerpt underneath. Choosing a post opens the full passage. There is no public composer and no video.

## Sub-features

- `teaching-open` opens the 教學 view from the bottom nav.
- `teaching-list` renders seeded posts in `#teachingList` with title + excerpt (not “Course 1”).
- `teaching-detail` opens the full passage in `#teachingDetailPane` with `#teachingBackBtn`.
- `teaching-owner-hidden` keeps `#teachingOwnerBar` / 新增文章 hidden unless the Clerk user is the site owner.

## How to get to it (user POV)

- Choose bottom-nav **教學** (`button.nav-item[data-view="teaching"]`).
- Choose a post (`article.post[data-lesson-id]`) to read the full text.
- Choose **← 返回** (`#teachingBackBtn`) to go back to the list.
- Deep link: `/#teaching` or `/#teaching/<id>` after sign-in.
- Owner-only: **＋ 新增文章** on the list, **編輯** / **刪除** on the detail pane.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- `site/content/lessons.json` is present (not `site/data/`). Local static serve must expose `/content/lessons.json`.
- `--bypass-auth` has no Clerk user, so owner controls stay hidden. That is the unsigned-editor proof, not a live owner-session proof.

- **Open teaching.** Choose 教學. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature teaching --bypass-auth`. `#view-teaching` is `.active`, nav `data-view="teaching"` is `.active`.
- **Read the list.** `#teachingList` contains `article.post` rows. The first row has a `.post-title` that is not `Course 1` / `課程 1`, and a `.post-excerpt` with passage text. `#addLessonBtn` is not visible (`#teachingOwnerBar` is `hidden`).
- **Open a post.** Choose the first `article.post`. `#teachingDetailPane` is visible, `#teachingListPane` is hidden, and `#teachingDetail .post-body` contains more of the passage than the excerpt. `#teachingBackBtn` is visible.
- **Return.** Choose **← 返回**. `#teachingListPane` is visible again.
- **Proof.** `artifacts/teaching/01-list.png` shows 教學 in the bottom nav and at least one post title + excerpt. `artifacts/teaching/02-detail.png` shows the full passage and 返回. `result.json` `ok: true`.

## Gotchas

- Do not look in `site/data/` for lessons; deploy overwrites that tree. Seeds live in `site/content/lessons.json`.
- Owner create/edit is not available under `--bypass-auth`. Do not report a missing 新增文章 button as a product bug in that mode.
- There is no video player, iframe, or embed on this view. A YouTube URL in body text (if someone pastes one later) must still render as text.
- Hash `#teaching` is the in-app route. The document URL stays `/`.
