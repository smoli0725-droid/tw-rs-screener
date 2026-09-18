# Teaching (教學)

教學 is a text-first feed of short owner-written passages. The list looks like posts on X: **cover image on top** (when present), then a bold title, then a short excerpt. Choosing a post opens the full passage plus the same cover. There is no public composer and no video.

## Sub-features

- `teaching-open` opens the 教學 view from the bottom nav.
- `teaching-list` renders seeded posts in `#teachingList` with cover (optional) above title + excerpt (not “Course 1”).
- `teaching-detail` opens the full passage in `#teachingDetailPane` with `#teachingBackBtn` and the cover image.
- `teaching-owner-hidden` keeps `#teachingOwnerBar` / 新增文章 / 刪除 hidden unless the Clerk user is the site owner.

## How to get to it (user POV)

- Choose bottom-nav **教學** (`button.nav-item[data-view="teaching"]`).
- Choose a post (`article.post[data-lesson-id]`) to read the full text.
- Choose **← 返回** (`#teachingBackBtn`) to go back to the list.
- Deep link: `/#teaching` or `/#teaching/<id>` after sign-in.
- Owner-only: **＋ 新增文章** on the list (cover URL field `#lessonCoverUrl`), **編輯** / **刪除** on the detail pane, and **刪除** on list cards. Confirm in `#deleteLessonDialog`.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- `site/content/lessons.json` is present (not `site/data/`). Local static serve must expose `/content/lessons.json`.
- `--bypass-auth` has no Clerk user, so owner controls stay hidden. That is the unsigned-editor proof, not a live owner-session proof.

- **Open teaching.** Choose 教學. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature teaching --bypass-auth`. `#view-teaching` is `.active`, nav `data-view="teaching"` is `.active`.
- **Read the list.** `#teachingList` contains `article.post` rows. A seeded row has `img.post-cover` **above** `.post-title`, then `.post-excerpt`. The title is not `Course 1` / `課程 1`. `#addLessonBtn` is not visible (`#teachingOwnerBar` is `hidden`). List cards have no 刪除.
- **Open a post.** Choose the first `article.post`. `#teachingDetailPane` is visible, `#teachingListPane` is hidden, `#teachingDetail img.post-cover` is present, and `#teachingDetail .post-body` contains more of the passage than the excerpt. `#teachingBackBtn` is visible. No owner 刪除.
- **Return.** Choose **← 返回**. `#teachingListPane` is visible again.
- **Proof.** `artifacts/teaching/01-list.png` shows 教學 in the bottom nav and at least one post with cover above title + excerpt. `artifacts/teaching/02-detail.png` shows the cover, full passage, and 返回. `result.json` `ok: true`.

## Gotchas

- Do not look in `site/data/` for lessons; deploy overwrites that tree. Seeds live in `site/content/lessons.json`.
- Cover is `cover_url` (https or same-origin path). There is no R2 upload; the owner pastes a URL.
- Owner create/edit/delete is not available under `--bypass-auth`. Do not report a missing 新增文章 / 刪除 button as a product bug in that mode.
- There is no video player, iframe, or embed on this view. A YouTube URL in body text (if someone pastes one later) must still render as text.
- Hash `#teaching` is the in-app route. The document URL stays `/`.
