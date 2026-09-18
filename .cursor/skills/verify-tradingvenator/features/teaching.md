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
- Owner-only: **＋ 新增文章** on the list, **選擇圖片上傳** (`#lessonCoverFile`) on the form, **編輯** / **刪除** on the detail pane, and **刪除** on list cards. Confirm in `#deleteLessonDialog`. Cover is a file picker on the website; do not treat git JSON or paste-URL as the owner path.

## Driving it with tv-verify

Preconditions:

- Doctor `ok: true`. Local `--bypass-auth` or live disposable session.
- `site/content/lessons.json` is present (not `site/data/`). Local static serve must expose `/content/lessons.json`.
- `--bypass-auth` has no Clerk user, so owner controls stay hidden. That is the unsigned-editor proof, not a live owner-session proof.

- **Open teaching.** Choose 教學. Run `node .cursor/skills/verify-tradingvenator/scripts/drive.mjs --feature teaching --bypass-auth`. `#view-teaching` is `.active`, nav `data-view="teaching"` is `.active`.
- **Read the list.** `#teachingList` contains `article.post` rows. A seeded row has `img.post-cover` **above** `.post-title`, then `.post-excerpt`. The title is not `Course 1` / `課程 1`. `#addLessonBtn` is not visible (`#teachingOwnerBar` is `hidden`). List cards have no 刪除.
- **Open a post.** Choose the first `article.post`. `#teachingDetailPane` is visible, `#teachingListPane` is hidden, `#teachingDetail img.post-cover` is present, and `#teachingDetail .post-body` contains more of the passage than the excerpt. `#teachingBackBtn` is visible. No owner 刪除.
- **Return.** Choose **← 返回**. `#teachingListPane` is visible again.
- **Proof.** `artifacts/teaching/01-list.png` shows 教學 in the bottom nav and at least one post with cover above title + excerpt. `artifacts/teaching/02-detail.png` shows the cover, full passage, and 返回. Local `--bypass-auth` then mocks `RS_AUTH.isOwner` to open the editor (`04-owner-editor.png`) with **選擇圖片上傳**. `result.json` `ok: true`.

## Gotchas

- Cover is stored as `cover_url` after `POST /api/lessons/cover` (Clerk + owner, R2). The owner picker is `#lessonCoverFile`. `#lessonCoverUrl` is a hidden field filled by upload. A collapsed 進階 details is not the product path. If R2 binding `TEACHING_COVERS` is missing, the editor shows a setup error — that is one-time infra, not how you add a lesson.
- `site/content/lessons.json` seeds the empty-D1 list for local/static proof only. Owner day-to-day must not need to edit it. Do not look in `site/data/` for lessons.
- Owner create/edit/delete is not available under `--bypass-auth`. Do not report a missing 新增文章 / 刪除 button as a product bug in that mode.
- There is no video player, iframe, or embed on this view. A YouTube URL in body text (if someone pastes one later) must still render as text.
- Hash `#teaching` is the in-app route. The document URL stays `/`.
