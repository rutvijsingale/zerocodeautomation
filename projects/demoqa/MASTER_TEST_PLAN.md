# demoqa.com — Master Test Plan

> Exhaustive end-to-end test plan covering every page, component, widget,
> form and interactive feature on `https://demoqa.com/`. Organised
> feature-by-feature so an automation engineer can implement directly.
>
> Companion to the Selenium + Java + Cucumber suite in this folder
> (`src/test/resources/features/*.feature` already implements ~70 of the
> 270+ scenarios listed below; this document is the source-of-truth for
> the remaining coverage).

## Table of contents

1. [Global preconditions / cross-cutting concerns](#0-global)
2. [Section 1 — Elements](#1-elements)
3. [Section 2 — Forms](#2-forms)
4. [Section 3 — Alerts, Frame &amp; Windows](#3-alerts-frame--windows)
5. [Section 4 — Widgets](#4-widgets)
6. [Section 5 — Interactions](#5-interactions)
7. [Section 6 — Book Store Application](#6-book-store-application)
8. [Cross-browser &amp; responsive matrix](#cross-browser--responsive)
9. [Data-driven variation appendix](#data-driven-appendix)

---

<a id="0-global"></a>
## 0. Global preconditions / cross-cutting concerns

These apply to **every** scenario unless otherwise stated.

| Concern | Default |
|---|---|
| Base URL | `https://demoqa.com/` |
| Browsers under test | Chrome (latest), Firefox (latest ESR), Safari (Mac only), Edge (Win only) |
| Viewports | Desktop 1920×1080, Laptop 1366×768, Tablet 768×1024, Mobile 375×667 |
| Implicit wait | 0s — explicit waits only |
| Default explicit wait | 10s for visibility / clickability |
| Network | Online, no proxy. Sites embeds AdSense — tests must `removeAds()` before interactions (covered by `BasePage.removeAds()` already). |
| Authentication | None except Book Store. Account: `BOOKSTORE_USER` env var (default `zac-demo-user`). |
| Test data | Per data-driven appendix at the bottom. |
| Self-healing | 5-tier locator chain (`data-testid → ARIA → CSS → XPath → visual`). Covered by `HealerEngine`. |
| Reporting | Allure (`reports/allure-results/`) + Cucumber HTML + `smoke_test_results.json`. |

**Site-wide preconditions every scenario inherits**

1. `removeAds()` strips the fixed-bottom Ad.Plus iframe + footer that intercepts clicks on demoqa.
2. `wait until document.readyState === 'complete'` after every navigation.
3. `clearLocalStorage` + `clearCookies` between scenarios so dynamic-properties / book-store state can't leak.

**Site-wide negative scenarios** (run once per browser, not per page)

| # | Scenario | Steps | Expected |
|---|---|---|---|
| G-N1 | 404 page renders the menu | Visit `/this-route-does-not-exist` | 404 page or fallback renders, left-nav still present |
| G-N2 | DNS-blocked AdSense doesn't break the page | Block `pagead2.googlesyndication.com` at the network layer | Every interactive page still loads and is clickable |
| G-N3 | JavaScript disabled fallback | Disable JS, hit `/elements` | Static menu + redirect message; no broken layout |

**Site-wide responsive scenarios**

| # | Scenario | Viewport | Expected |
|---|---|---|---|
| G-R1 | Hamburger / collapsed left nav at mobile width | 375×667 | Left nav collapses; clicking a card still navigates |
| G-R2 | Footer ad doesn't push content off-screen | 768×1024 | Body content remains scrollable, no horizontal scroll |

---

<a id="1-elements"></a>
## 1. Section — Elements (`/elements`)

Pages: `/text-box`, `/checkbox`, `/radio-button`, `/webtables`, `/buttons`, `/links`, `/broken`, `/upload-download`, `/dynamic-properties`.

### 1.1 `/text-box` — text input form

**Component:** Form with 4 inputs (Full Name, Email, Current Address, Permanent Address), Submit button, output panel.

| ID | Type | Scenario | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| TB-P1 | positive | Submit with all four fields filled | Page loaded | 1. Type "Naysha Ingale" into `#userName`<br>2. Type "qa.zac@example.com" into `#userEmail`<br>3. Type "221B Baker Street, London" into `#currentAddress`<br>4. Type "12 ZAC Lane, Pune" into `#permanentAddress`<br>5. Click `#submit` | Output panel `#output` visible. `#output #name` contains "Naysha Ingale". `#output #email` contains email. Both addresses echoed verbatim. |
| TB-P2 | positive | Submit with only Name + Email filled | Page loaded | 1-2 + 5 (skip addresses) | Output panel visible. Address rows in output are absent or empty. |
| TB-P3 | positive | Same address pasted into both fields | Page loaded | 1-5 with same string in both addresses | Output renders both rows identically. |
| TB-N1 | negative | Submit with all fields empty | Page loaded | Click `#submit` | Output panel NOT shown. No JS errors. |
| TB-N2 | negative | Invalid email — no `@` | Page loaded | Email = "not-an-email", click submit | `#userEmail` gets class `field-error`. Output panel hidden. |
| TB-N3 | negative | Invalid email — trailing space | Page loaded | Email = "user@example.com " | Same as TB-N2 (trailing space rejected). |
| TB-N4 | negative | Email with valid TLD but invalid local-part | Email = "@example.com" | Submit | field-error class applied. |
| TB-E1 | edge | 500-character paste into both addresses | Page loaded | Paste 500 'a' into both addresses, submit | Output renders all 500 chars. Page doesn't crash. |
| TB-E2 | edge | Multi-line address (newlines) | Address = "line1\nline2\nline3" | Submit | Output preserves the newlines (renders multiline). |
| TB-E3 | edge | Unicode + emoji in name | Name = "Mira 🌸 Pâté" | Submit | Output renders emoji + accented chars. |
| TB-B1 | boundary | Single-character name | Name = "X", submit | Output shows "X". |
| TB-B2 | boundary | Email exactly at common 254-char ceiling | 254-char email | Submit | Accepted (no client-side cap). |
| TB-V1 | validation | Tab order Name → Email → Current → Permanent | Press Tab from each field | Focus moves in declared order. |
| TB-V2 | validation | Submit button is keyboard-activatable | Tab to submit, press Enter | Form submits. |
| TB-DD | data-driven | See [DD-TB](#dd-text-box) | — | Run TB-P1 with each row | All rows produce a populated output panel. |

**Cross-browser:** TB-P1 + TB-N2 on each browser. Email validation styling can differ on Safari (does not natively show `:invalid` outline) — assert via class, not by colour.

**Responsive:** at 375×667 the form fields stack. TB-P1 must still pass.

---

### 1.2 `/checkbox` — collapsible tree of checkboxes

**Component:** RC-Tree with Home → Desktop, Documents → (WorkSpace, Office), Downloads → (Word File, Excel File). Buttons: Expand all, Collapse all. Result panel `#result`.

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| CB-P1 | positive | Expand all reveals every node | Click Expand all | All ~16 leaf nodes visible. |
| CB-P2 | positive | Selecting a leaf adds its name to the result | Expand → click "Excel File" | `#result` contains `excelFile` (camel-cased token). |
| CB-P3 | positive | Selecting Home cascades to all children | Expand → click Home checkbox | Result contains tokens for every leaf (`home`, `desktop`, `notes`, `commands`, …). |
| CB-P4 | positive | Partial-select state on parent when child unchecked | Select Home, then uncheck Desktop | Home now shown as partial (icon class `rct-icon-half-check`). |
| CB-P5 | positive | Collapse-then-expand preserves selection | Select Home, Collapse all, Expand all | Selection state intact. |
| CB-N1 | negative | Default state has no selections | Open page | `#result` is empty / hidden. |
| CB-N2 | negative | Toggling Home off clears all child tokens | Select Home, deselect Home | `#result` empty. |
| CB-E1 | edge | Rapid 5× toggle Expand/Collapse | Loop 5 times | Tree still renders, no orphaned DOM nodes. |
| CB-E2 | edge | Keyboard navigation through tree | Focus tree, ArrowDown ×5, Space | Last-focused node toggled; result updates. |
| CB-DD | data-driven | See [DD-CB](#dd-checkbox) | Each tuple `(toggle path, expected tokens)` | Result panel matches the expected-tokens column. |

**Validation:** result tokens are normalized (e.g. "Word File" → `wordFile`). Assertions must check the camelCase form, not the visible label.

---

### 1.3 `/radio-button` — Yes / Impressive / No

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| RB-P1 | positive | Select Yes | Click Yes label | Success text "You have selected Yes". |
| RB-P2 | positive | Select Impressive | Click Impressive label | Success text "You have selected Impressive". |
| RB-P3 | positive | Switching from Yes to Impressive | Click Yes, then Impressive | Result reads "Impressive" (only the latest). |
| RB-N1 | negative | No is disabled — clicking has no effect | Click No | `#noRadio` is `disabled`. Result text unchanged. |
| RB-N2 | negative | Default state has no result | Open page | No success text rendered. |
| RB-E1 | edge | Selecting Yes 3× is idempotent | Click Yes 3 times | Result still "Yes". |
| RB-V1 | validation | Keyboard ArrowRight cycles Yes ↔ Impressive | Focus Yes, ArrowRight | Impressive selected. |
| RB-V2 | validation | `<label>` clicks check the underlying radio | Click `<label for="yesRadio">` (not the input) | Yes is selected (radio's input.checked=true). |

---

### 1.4 `/webtables` — CRUD table

**Component:** React-table with 3 seeded rows (Cierra Vega, Alden Cantrell, Kierra Gentry). Add button → modal with First/Last/Email/Age/Salary/Department. Per-row Edit + Delete icons. Search box filters all columns. Pagination footer.

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| WT-P1 | positive | Default 3 rows present | Open page | Exactly 3 data rows. |
| WT-P2 | positive | Add a new row | Click Add → fill form → Submit | New row appended. Row count = 4. |
| WT-P3 | positive | Edit an existing row | Edit pencil row 1 → change first name → Submit | Row 1 first-name updated; count unchanged. |
| WT-P4 | positive | Delete a row | Delete trash row 2 | Row removed; count = 2 (or 3 if previously added). |
| WT-P5 | positive | Search by first name | Search box: "Cierra" | Only matching row visible. |
| WT-P6 | positive | Search by salary | Search: "10000" | Only matching salary row. |
| WT-P7 | positive | Search by department | Search: "Insurance" | Only matching department row. |
| WT-P8 | positive | Clear search restores all rows | Type then clear search | All rows restored. |
| WT-N1 | negative | Add with empty First Name | Click Add → only fill last name → Submit | First Name `is-invalid`. Modal stays. |
| WT-N2 | negative | Add with non-numeric Age | Age = "abc" | Age field `is-invalid`. |
| WT-N3 | negative | Add with invalid Email | Email = "no-at" | Email `is-invalid`. |
| WT-N4 | negative | Search returns no rows | Search: "ZZZNOTFOUND" | "No rows found" indicator visible. |
| WT-N5 | negative | Edit form Cancel | Edit row 1, change name, close modal via X | Row 1 unchanged. |
| WT-E1 | edge | Add 10 records — pagination kicks in | Loop add ×10 | Page 1 of N pagination visible; 5/10/20/25 rows per page selector works. |
| WT-E2 | edge | Delete every row | Loop delete until 0 | "No rows found" shown. |
| WT-E3 | edge | Add row with Unicode | First Name = "Łukáš" | Row stored verbatim. |
| WT-B1 | boundary | Age = 0 | Add row, Age = "0" | Row added (no min-age validation). |
| WT-B2 | boundary | Age = 999 | Add row, Age = "999" | Row added. |
| WT-V1 | validation | Re-load (refresh) discards added rows | Add row, refresh page | Returns to default 3 rows (no persistence). |
| WT-DD | data-driven | See [DD-WT](#dd-webtables) | — | All rows reach the table. |

---

### 1.5 `/buttons`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| BT-P1 | positive | Double-click triggers message | Double-click `#doubleClickBtn` | `#doubleClickMessage` visible "You have done a double click". |
| BT-P2 | positive | Right-click triggers message | Context-click `#rightClickBtn` | `#rightClickMessage` visible "You have done a right click". |
| BT-P3 | positive | Single-click on dynamic button | Click button[normalize-space()='Click Me'] | `#dynamicClickMessage` visible. |
| BT-N1 | negative | Single-click on Double Click button | `.click()` once | Message NOT shown. |
| BT-N2 | negative | Single-click on Right Click button | Left click | Message NOT shown. |
| BT-E1 | edge | Three buttons fired in sequence | dblclick + ctxclick + click | All 3 messages visible together. |
| BT-V1 | validation | Recorded as correct action types | Use ZAC recorder | Generated code uses Actions.doubleClick / contextClick / element.click respectively. |

---

### 1.6 `/links`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| LK-P1 | positive | Home link opens `demoqa.com` in new tab | Click `#simpleLink` | Window count +1. New tab URL contains `demoqa.com`. |
| LK-P2 | positive | Dynamic Home link (random suffix) opens new tab | Click `#dynamicLink` | Same as LK-P1. |
| LK-API1..7 | positive | API links return expected codes | For each `[#created, #no-content, #moved, #bad-request, #unauthorized, #forbidden, #invalid-url]`, click | `#linkResponse` contains 201, 204, 301, 400, 401, 403, 404 respectively. |
| LK-N1 | negative | API response panel hidden until first click | Open page | `#linkResponse` empty. |
| LK-E1 | edge | Click two API links rapidly | Click Created then No Content within 200ms | Latest response (204) shown. |
| LK-V1 | validation | New tab link has `target="_blank"` | DOM check | `#simpleLink[target="_blank"]`. |
| LK-DD | data-driven | All 7 status codes (DD-LK) | — | Each code rendered. |

---

### 1.7 `/broken` — broken images and links

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| BK-P1 | positive | Valid image renders | Open page | Valid `<img>` has `naturalWidth > 0`. |
| BK-N1 | negative | Broken image present but unrendered | Same | Broken `<img>.naturalWidth === 0`. |
| BK-P2 | positive | Click Valid Link → demoqa.com loads in same tab | Click "Click Here for Valid Link" | URL contains demoqa.com. |
| BK-N2 | negative | Click Broken Link → returns 500 | Click "Click Here for Broken Link" | New page is `the-internet.herokuapp.com/status_codes/500`, body contains "500". |
| BK-E1 | edge | Reload page — broken image still broken | Refresh | Same `naturalWidth === 0` assertion holds. |

---

### 1.8 `/upload-download`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| UP-P1 | positive | Download the file | Click Download button | A file `sampleFile.jpeg` lands in the download dir. |
| UP-P2 | positive | Upload a small text file | `#uploadFile.sendKeys(absPath)` | `#uploadedFilePath` shows `C:\fakepath\<filename>` or `/.../<filename>`. |
| UP-P3 | positive | Upload then re-upload — replaces the path label | Two uploads | Latest filename shown. |
| UP-N1 | negative | No upload performed | Open page | `#uploadedFilePath` empty. |
| UP-E1 | edge | Upload a 10 MB file | Generate 10MB file, upload | Path label shows. (No size cap on demoqa.) |
| UP-E2 | edge | Filename with spaces + Unicode | Path = `/tmp/mañana spaces.txt` | Label includes the encoded filename. |
| UP-V1 | validation | Recorded as `sendKeys`, not click | Use ZAC recorder | Generated code: `el.sendKeys("/abs/path")`. |

---

### 1.9 `/dynamic-properties`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| DP-P1 | positive | "Will enable 5 seconds" becomes clickable after 5s | Open, wait | `#enableAfter` enabled within 8s. |
| DP-P2 | positive | "Visible After 5 Seconds" appears | Open, wait | `#visibleAfter` visible within 8s. |
| DP-P3 | positive | "Color Change" turns red | Open, wait | `#colorChange` has class `text-danger` within 8s. |
| DP-N1 | negative | enable-after disabled at t=0 | Open page | `#enableAfter[disabled]`. |
| DP-N2 | negative | Click enable-after at t=1s does nothing | Force click | No state change; no message. |
| DP-E1 | edge | All three resolved in one run | Wait 6s | All three asserts pass within the same scenario. |
| DP-V1 | validation | Generated code uses WebDriverWait + ExpectedConditions | Recorder | Java: `new WebDriverWait(d, Duration.ofSeconds(8)).until(...)`. |

---

<a id="2-forms"></a>
## 2. Section — Forms (`/automation-practice-form`)

**Component:** Single page form with: First Name, Last Name, Email, 3-radio Gender, Mobile, Date of Birth (calendar), Subjects (multi-tag autocomplete), 3-checkbox Hobbies, Picture upload, Current Address, State (react-select), City (react-select dependent on State), Submit. On submit a Bootstrap modal `div.modal.show` lists all values.

| ID | Type | Scenario | Preconditions | Steps | Expected |
|---|---|---|---|---|---|
| FM-P1 | positive | Submit a fully-filled male form | Form open | All fields, gender Male, hobby Reading, state NCR/city Delhi, valid PNG upload, submit | Modal title "Thanks for submitting the form". Each label row matches input. |
| FM-P2 | positive | Female + 2 hobbies + UP/Lucknow | — | Female, Sports + Music, UP/Lucknow, submit | Modal Hobbies row contains both. |
| FM-P3 | positive | Other + 3 hobbies + Haryana/Karnal | — | Other, all 3 hobbies, Haryana/Karnal, submit | Modal Gender row "Other"; Hobbies contains Sports, Reading, Music. |
| FM-P4 | positive | Subject autocomplete adds two tags | — | Type "Mat" → pick Maths; type "Phy" → pick Physics; submit | Modal "Subjects" row "Maths, Physics". |
| FM-P5 | positive | Date-of-birth via calendar | — | Open DoB → pick Jan 15 1990 | DoB input value `15 Jan 1990`. After submit modal echoes same. |
| FM-P6 | positive | Picture upload .png + .jpg accepted | — | Upload `headshot.png`; submit | Modal Picture row shows filename. |
| FM-P7 | positive | Tab-key submission | — | Fill form via Tab key only, Enter on Submit | Modal opens. |
| FM-P8 | positive | Modal dismissal via Close button | After FM-P1 | Click `#closeLargeModal` | Modal hidden. |
| FM-P9 | positive | Modal dismissal via X icon | After FM-P1 | Click `.close` icon | Modal hidden. |
| FM-N1 | negative | Submit empty form | Open page | Click Submit | Modal NOT visible. `#firstName.field-error` AND `#lastName.field-error` AND `#userNumber.field-error`. Gender radio group highlighted. |
| FM-N2 | negative | First Name only | Fill only first | Submit | First Name OK; Last Name + Mobile + Gender all `field-error`. Modal hidden. |
| FM-N3 | negative | Mobile shorter than 10 digits | Mobile = "12345" | Submit | Mobile `field-error`. Modal hidden. |
| FM-N4 | negative | Mobile longer than 10 digits | Mobile = "12345678901" | After 10 digits, input rejects 11th | Field accepts only 10 chars (HTML maxlength). |
| FM-N5 | negative | Mobile non-numeric | Mobile = "abcdefghij" | — | Empty after blur (input strips non-digits). Field-error on submit. |
| FM-N6 | negative | Invalid email format | Email = "not-an-email" | Submit | Email `field-error`. |
| FM-N7 | negative | Invalid date typed | DoB input bypassed → "32/13/2099" | Click outside, submit | DoB resets to today; submit succeeds. (Or `field-error`, version-dependent.) |
| FM-N8 | negative | Picture upload — non-image extension | `headshot.exe` | — | Upload accepted (no client-side filter). Modal still opens; Picture row shows `headshot.exe`. (Doc this as known limitation.) |
| FM-N9 | negative | State picked but no City picked | NCR, no city | Submit | Form submits with State only; City row is empty. (No "city required" rule.) |
| FM-E1 | edge | All hobbies + all genders sequence | Click Male → Female → Other; toggle all hobbies | Submit | Gender = Other (last wins). Hobbies row contains 3. |
| FM-E2 | edge | Multiple subjects then remove one | Add 3 subjects, click X on middle one | Submit | Modal Subjects row has 2 remaining subjects in order. |
| FM-E3 | edge | Re-open form via Close, refill | After successful submit, Close, change First Name, Submit | Modal opens with new value. |
| FM-E4 | edge | Picture file 0 bytes | Empty file upload | Submit | Modal opens; Picture row shows filename. |
| FM-E5 | edge | DoB exactly today | DoB = today | Submit | Echoed verbatim. |
| FM-E6 | edge | DoB very old (year 1900) | DoB = 01 Jan 1900 | Submit | Echoed verbatim. (No min-age validation.) |
| FM-E7 | edge | Address > 500 chars with newlines | — | Submit | Modal Address row preserves newlines. |
| FM-B1 | boundary | Mobile exactly 10 digits | "1234567890" | Submit | Accepted. |
| FM-V1 | validation | State dropdown opens before City is enabled | Tab to State, Open | State options visible; City still says "Select City". |
| FM-V2 | validation | City options are state-dependent | NCR | City options = Delhi, Gurgaon, Noida. |
| FM-V3 | validation | City options refresh when State changes | Change State NCR → UP | Old City options gone; new ones (Agra, Lucknow, Merrut) in their place. |
| FM-V4 | validation | Modal table preserves field order | Submit | Row order: Student Name, Student Email, Gender, Mobile, Date of Birth, Subjects, Hobbies, Picture, Address, State and City. |
| FM-DD | data-driven | See [DD-FM](#dd-forms) | Examples table | Each row produces a populated modal. |

**Cross-browser:** The react-select dropdowns (State/City) trigger differently in Safari for keyboard navigation. Add explicit click-then-arrow-then-Enter alternative path. The HTML `<input type=file>` looks different on each browser but `sendKeys` works uniformly.

**Responsive:** at 375×667 the form stacks. The Submit button hides under the AdSense footer — `removeAds()` is mandatory. The modal-show overlay is full-screen on mobile and assertions on `.modal-content` width must use a relative comparison rather than a hard pixel value.

---

<a id="3-alerts-frame--windows"></a>
## 3. Section — Alerts, Frame & Windows

Pages: `/browser-windows`, `/alerts`, `/frames`, `/nestedframes`, `/modal-dialogs`.

### 3.1 `/browser-windows`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| BW-P1 | positive | New Tab opens demoqa sample page | Click `#tabButton` | New window/tab opens. URL contains `/sample`. Heading `#sampleHeading` reads "This is a sample page". |
| BW-P2 | positive | New Window opens same sample page | Click `#windowButton` | Same as BW-P1 but a popup window. |
| BW-P3 | positive | New Window Message | Click `#messageWindowButton` | Popup window body text contains "Knowledge increases by sharing". |
| BW-N1 | negative | Sample heading NOT on origin tab | Open page | `#sampleHeading` not found at root. |
| BW-N2 | negative | Closing the new tab returns to origin | After BW-P1, close new tab | Driver auto-returns to origin window when `driver.close()` is invoked. |
| BW-E1 | edge | Three new tabs in sequence | Click New Tab × 3 | Each opens a fresh tab. Origin still browse-able. |
| BW-E2 | edge | Popup blocker simulation | Browser arg `--disable-popup-blocking=false` | Popup may be blocked → assertion shows the same window count. (Doc as browser config dependency.) |

### 3.2 `/alerts`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| AL-P1 | positive | Basic alert accept | Click `#alertButton` → accept | Alert text "You clicked a button". Alert dismissed. |
| AL-P2 | positive | Confirm box accept → "Ok" result | Click `#confirmButton` → accept | `#confirmResult` reads "You selected Ok". |
| AL-P3 | positive | Prompt box accept with text | Click `#promtButton`, sendKeys "ZAC", accept | `#promptResult` contains "ZAC". |
| AL-P4 | positive | Timer alert accept after 5s | Click `#timerAlertButton`, wait 6s, accept | Alert text "This alert appeared after 5 seconds". |
| AL-N1 | negative | Confirm box dismiss → "Cancel" | Click `#confirmButton` → dismiss | `#confirmResult` reads "You selected Cancel". |
| AL-N2 | negative | Prompt box dismiss without text | `#promtButton` → dismiss | `#promptResult` empty. |
| AL-N3 | negative | Prompt box accept without text | `#promtButton` → accept (no input) | `#promptResult` reads "You entered ". |
| AL-E1 | edge | Click confirm twice rapidly | Click button twice | Latest alert handled; no orphan dialog. |
| AL-E2 | edge | Timer alert dismissed | After 5s wait, dismiss | Alert closes; no result label changes. |
| AL-V1 | validation | Recorded as switchTo().alert() | Recorder | Java: `driver.switchTo().alert().accept();` |

### 3.3 `/frames`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| FR-P1 | positive | Frame 1 contains the sample heading | switchTo(`#frame1`), read `#sampleHeading` | Text == "This is a sample page". |
| FR-P2 | positive | Frame 2 contains same text | switchTo(`#frame2`) | Text == "This is a sample page". |
| FR-P3 | positive | switchTo().defaultContent() returns to root | switchTo `#frame1`, then defaultContent | `#sampleHeading` no longer reachable; the outer `#framesWrapper` is. |
| FR-N1 | negative | Without switching, accessing inside-frame elements fails | At root, `findElement(By.id("sampleHeading"))` | NoSuchElementException raised. |
| FR-V1 | validation | Frame WebElement accepted by switchTo | Use `driver.switchTo().frame(driver.findElement(By.id("frame1")))` | Switches successfully. |

### 3.4 `/nestedframes`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| NF-P1 | positive | Parent frame body contains "Parent frame" | switchTo `#frame1` | `body.text` contains "Parent frame". |
| NF-P2 | positive | Child iframe inside parent contains "Child Iframe" | switchTo `#frame1`, then nested `iframe` | `<p>` text == "Child Iframe". |
| NF-V1 | validation | defaultContent unwinds the full chain | Switch nested → defaultContent | Original page elements reachable. |

### 3.5 `/modal-dialogs`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| MD-P1 | positive | Small modal opens with correct title | Click `#showSmallModal` | `#example-modal-sizes-title-sm` reads "Small Modal". |
| MD-P2 | positive | Small modal closes via X icon | After MD-P1, click `.close` | `.modal.show` no longer present. |
| MD-P3 | positive | Small modal closes via Close button | After MD-P1, click `#closeSmallModal` | `.modal.show` gone. |
| MD-P4 | positive | Large modal opens with correct title | Click `#showLargeModal` | `#example-modal-sizes-title-lg` reads "Large Modal". |
| MD-P5 | positive | Large modal closes via Close | After MD-P4, click `#closeLargeModal` | Modal gone. |
| MD-N1 | negative | Closing a never-opened modal is a no-op | Open page | No modal visible. |
| MD-N2 | negative | Click outside modal — backdrop dismiss | Click `.modal-backdrop` | (Bootstrap default) modal closes. |
| MD-E1 | edge | Open Small, Close, Open Large, Close | Sequence | Each action atomic; no leaked classes on `body`. |
| MD-V1 | validation | `body` gets class `modal-open` while modal visible | Open modal, inspect | `body.class` contains `modal-open`. |
| MD-V2 | validation | Focus trapped in modal | Tab through modal | Focus cycles inside `.modal-content`; doesn't escape to underlying page. |

---

<a id="4-widgets"></a>
## 4. Section — Widgets

Pages: `/accordian`, `/auto-complete`, `/date-picker`, `/slider`, `/progress-bar`, `/tabs`, `/tool-tips`, `/menu`, `/select-menu`.

### 4.1 `/accordian`

3 collapsible sections: "What is Lorem Ipsum?", "Where does it come from?", "Why do we use it?".

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| AC-P1 | positive | Section 1 starts expanded by default | Open page | `#section1Content.show` visible. |
| AC-P2 | positive | Click section 1 → collapses | Click `#section1Heading` | `#section1Content` no longer has `show`. |
| AC-P3 | positive | Click section 2 → expands, collapses 1 | Click `#section2Heading` | Section 2 expanded, Section 1 collapsed. |
| AC-P4 | positive | Click section 3 → expands | Click `#section3Heading` | `#section3Content.show`. |
| AC-N1 | negative | Section 3 starts collapsed | Open page | `#section3Content` not `show`. |
| AC-N2 | negative | Clicking already-open section 1 collapses it (single-section behaviour) | After load | Section 1 toggled. |
| AC-E1 | edge | Rapid 5× click on Section 1 | — | Final state deterministic (open/closed depending on parity). |
| AC-V1 | validation | Heading is keyboard-activatable (Enter, Space) | Tab to heading, Enter | Section toggles. |

### 4.2 `/auto-complete`

Two inputs: Multi-color and Single-color. Each filters from {Red, Blue, Green, Yellow, White, Black, Voilet, Indigo, Magenta, Aqua, Purple}.

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| AT-P1 | positive | Multi: type "re" → suggestions appear | Click `#autoCompleteMultipleInput`, type "re" | Dropdown shows Red, Green, Purple (all that contain "re"). |
| AT-P2 | positive | Multi: pick Red → chip appears | After AT-P1, click "Red" option | Chip rendered as a `div.auto-complete__multi-value`. |
| AT-P3 | positive | Multi: pick 3 colors | Add Red, Blue, Green | 3 chips visible. |
| AT-P4 | positive | Multi: remove a chip via X | Click X on Red chip | Chip count -1. |
| AT-P5 | positive | Single: type "bl" → pick Blue | type and select | `div.auto-complete__single-value` reads "Blue". |
| AT-P6 | positive | Single: replacing the selection | After Blue, type "gr", pick Green | Single chip changes to Green. |
| AT-N1 | negative | Multi: garbage input "zzzzz" | type | Dropdown shows "No options". |
| AT-N2 | negative | Multi: pressing Enter with no match | type "zzz" + Enter | No chip created. |
| AT-N3 | negative | Multi: same color twice — second click is a no-op | Add Red, type "re", click Red again | Chip count stays 1. |
| AT-E1 | edge | Multi: 11 colors (entire palette) | Add all | All 11 chips visible (no limit). |
| AT-E2 | edge | Multi: chip removal via Backspace at empty input | Add Red, focus input, Backspace | Red chip removed. |
| AT-V1 | validation | Recorded as multi-select selectByVisibleText (per generated code) | Recorder | Generated Java uses chip-style fill, NOT `Select`. |

### 4.3 `/date-picker`

Two inputs: Date (`#datePickerMonthYearInput`) and Date+Time (`#dateAndTimePickerInput`).

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| DT-P1 | positive | Type a valid date | Clear input, sendKeys "10/05/2025", Enter | Input value `10/05/2025`. |
| DT-P2 | positive | Pick a date via calendar | Open calendar, navigate, click 15 | Input shows that date. |
| DT-P3 | positive | Pick month & year via dropdowns | Open calendar, change Month=Jan, Year=2030 → click 1 | Input value `01/01/2030`. |
| DT-P4 | positive | Date+Time set via typing | Set "October 31, 2025 11:30 PM" | Input contains "October 31, 2025 11:30 PM". |
| DT-P5 | positive | Date+Time pick via calendar + clock | Pick date, change time slot | Input updates. |
| DT-N1 | negative | Empty date | Clear input, click outside | Field empty. (Some builds restore today; documented.) |
| DT-N2 | negative | Out-of-range date "32/13/2099" | Type | Browser strips invalid; field falls back to today. |
| DT-E1 | edge | Far future year (3000) | Pick Jan 2030 via dropdowns where year list ends → manual sendKeys "01/01/3000" | Accepted (no max). |
| DT-E2 | edge | Far past year (1900) | Same pattern | Accepted. |
| DT-V1 | validation | Calendar dropdowns disable disallowed dates | Open calendar | Future / past disabled cells (if any) have `--disabled`. |
| DT-DD | data-driven | See [DD-DT](#dd-date-picker) | — | All dates round-trip. |

### 4.4 `/slider`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| SL-P1 | positive | Drive right 5× | Focus slider, ArrowRight ×5 | Value increments by 5. |
| SL-P2 | positive | Drive left 10× | Focus, ArrowLeft ×10 | Value decrements by 10. |
| SL-P3 | positive | Drag by 100px to the right | Actions.dragAndDropBy | Value increases proportionally. |
| SL-N1 | negative | Pressing arrow far right caps at 100 | ArrowRight ×200 | Value === 100. |
| SL-N2 | negative | Pressing arrow far left caps at 0 | ArrowLeft ×200 | Value === 0. |
| SL-E1 | edge | Page Up / Page Down | Focus, PageUp ×3 | Value increments by 3 (or by step×3 depending on slider). |
| SL-V1 | validation | `aria-valuenow` matches `#sliderValue` | After any change | `slider.getAttribute('aria-valuenow') === sliderValue.value`. |

### 4.5 `/progress-bar`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| PB-P1 | positive | Start → progress increments | Click `#startStopButton` | `aria-valuenow` increases. |
| PB-P2 | positive | Stop mid-progress | Click again at ~50% | Stops; value frozen. |
| PB-P3 | positive | Reset returns to 0 | Click `#resetButton` | `aria-valuenow` == 0. |
| PB-P4 | positive | Reach 100 | Wait 12s | Bar reaches 100, button text changes to "Reset". |
| PB-N1 | negative | Bar at 0 by default | Open page | `aria-valuenow` == 0. |
| PB-E1 | edge | Start, Stop, Start again | Sequence | Resumes from current value, not 0. |
| PB-V1 | validation | aria-valuemin == 0, aria-valuemax == 100 | DOM check | Both attributes correct. |

### 4.6 `/tabs`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| TS-P1 | positive | What tab content visible by default | Open page | `#demo-tabpane-what` visible, has text containing "Lorem Ipsum". |
| TS-P2 | positive | Origin tab activates | Click `#demo-tab-origin` | `#demo-tabpane-origin` visible; What hidden. |
| TS-P3 | positive | Use tab activates | Click `#demo-tab-use` | `#demo-tabpane-use` visible. |
| TS-N1 | negative | More tab is disabled | Click `#demo-tab-more` | Tab class contains `disabled`. Pane stays unchanged. |
| TS-E1 | edge | Keyboard-only navigation | Focus What, ArrowRight | Origin tab focused; Enter activates it. |
| TS-V1 | validation | aria-selected toggles correctly | After clicking Origin | What `aria-selected=false`, Origin `aria-selected=true`. |

### 4.7 `/tool-tips`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| TT-P1 | positive | Hover button shows tooltip "You hovered over the Button" | moveToElement(`#toolTipButton`) | `.tooltip-inner` visible with that text. |
| TT-P2 | positive | Hover input shows tooltip | moveToElement(`#toolTipTextField`) | Tooltip "You hovered over the text field". |
| TT-P3 | positive | Hover the "Contrary" link in body | moveToElement link | Tooltip visible. |
| TT-P4 | positive | Hover the "1.10.32" link | Same | Tooltip visible. |
| TT-N1 | negative | No tooltip without hover | Open page | `.tooltip-inner` not present. |
| TT-E1 | edge | Hover, move away | moveToElement, then to body | Tooltip disappears within 1s. |
| TT-V1 | validation | Recorded as Actions.moveToElement | Recorder | Java: `new Actions(driver).moveToElement(el).perform();` |

### 4.8 `/menu`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| MN-P1 | positive | Hover Main Item 1 | moveToElement | No sub-menu (Main Item 1 has none); item is visible. |
| MN-P2 | positive | Hover Main Item 2 → sub-menu | moveToElement | Sub-list visible (Sub Item, Sub Item, SUB SUB LIST »). |
| MN-P3 | positive | Hover SUB SUB LIST → nested items | Hover chain: Main 2 → SUB SUB LIST | Nested Sub Sub Item 1, 2 visible. |
| MN-P4 | positive | Click a sub-item | Hover chain + click | (Anchor href="#" so no nav.) Click recorded. |
| MN-E1 | edge | Move outside menu — sub-list collapses | After P2, move to body | Sub-list hidden. |
| MN-V1 | validation | Sequential moveToElement records correctly | Recorder | Java: chain of `.moveToElement(el)` then `.perform()`. |

### 4.9 `/select-menu`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| SM-P1 | positive | "Select Value" → pick one | Click `#withOptGroup` → "Group 1, option 2" | Value displayed. |
| SM-P2 | positive | "Select One" → pick "Mr." | Click `#selectOne` → "Mr." | Value displayed. |
| SM-P3 | positive | "Old Style Select Menu" — selectByVisibleText "Yellow" | `new Select(#oldSelectMenu).selectByVisibleText("Yellow")` | Selected value `"3"`. |
| SM-P4 | positive | Old Style — selectByIndex 5 | — | Index 5 shows "Aqua". |
| SM-P5 | positive | Old Style — selectByValue "1" | — | Visible "Black". |
| SM-P6 | positive | Multi-select picks Green + Blue | `#cars` Select.selectByVisibleText for both | 2 selected options. |
| SM-P7 | positive | Multi-select deselect all | `Select#cars.deselectAll()` | 0 selected. |
| SM-P8 | positive | Multi-select all 4 | Loop selectByIndex 0-3 | All 4 selected. |
| SM-N1 | negative | "Select Value" no match | Type "zzz" in search | "No options". |
| SM-N2 | negative | Multi-select select non-existent option | selectByVisibleText("nope") | NoSuchElementException. |
| SM-V1 | validation | Old Style is a `<select>` (not a div) | DOM check | `tagName === SELECT`. |
| SM-V2 | validation | Recorded as `new Select(el).selectByVisibleText(...)`, not click | Recorder | Generated code uses Select API for native `<select>` elements. |

---

<a id="5-interactions"></a>
## 5. Section — Interactions

Pages: `/sortable`, `/selectable`, `/resizable`, `/droppable`, `/draggable`.

### 5.1 `/sortable`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| SO-P1 | positive | Reorder list — first → last | dragAndDrop(item[0], item[5]) | Order changed (item[0] position now contains old [1]). |
| SO-P2 | positive | Reorder grid — first → fourth | Switch Grid tab; dragAndDrop | Grid order changed. |
| SO-N1 | negative | Drop on the same position is a no-op | dragAndDrop(item[0], item[0]) | Order unchanged. |
| SO-E1 | edge | Drag with very small offset | dragAndDropBy(item[0], 5, 5) | Visual offset, but order may not change (under threshold). Documented. |
| SO-V1 | validation | DOM order matches visual order | After P1, read DOM | innerText sequence matches user's visual expectation. |

### 5.2 `/selectable`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| SE-P1 | positive | Click list item → highlights | Click li[0] | `li[0].class` contains `active`. |
| SE-P2 | positive | Click second item — both stay active | Click li[1] | Both 0 and 1 `active`. (Site doesn't enforce single-select.) |
| SE-P3 | positive | Click an active item — deactivates | Click li[0] again | li[0] no longer `active`. |
| SE-P4 | positive | Grid tab — same behaviours | Switch tab, click | Grid items toggle `active`. |
| SE-V1 | validation | `aria-selected` mirrors class | After P1 | `aria-selected="true"`. |

### 5.3 `/resizable`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| RS-P1 | positive | Restricted box grows up to its max | dragAndDropBy(handle, 100, 100) | New size ≤ 500×300 (its caps). |
| RS-N1 | negative | Restricted box does NOT exceed cap | dragAndDropBy(handle, 600, 600) | Width still ≤ 500, height ≤ 300. |
| RS-P2 | positive | Free-resize box grows beyond | dragAndDropBy(handle, 200, 200) | Width and height both increased; no cap. |
| RS-E1 | edge | Negative offset shrinks below min | dragAndDropBy(handle, -1000, -1000) | Box shrinks but stays > 0px on both axes. |
| RS-V1 | validation | Inline style updated | After P2 | `el.style.width` reflects new pixels. |

### 5.4 `/droppable`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| DR-P1 | positive | Simple drag → "Dropped!" | dragAndDrop(`#draggable`, `#droppable`) | `#droppable` text == "Dropped!". |
| DR-P2 | positive | Accept tab — Acceptable item drops | Switch tab; drag `#acceptable` to target | Target says "Dropped!". |
| DR-N1 | negative | Accept tab — Not Acceptable rejected | Drag `#notAcceptable` | Target text unchanged "Drop here". |
| DR-P3 | positive | Prevent Propagation — Greedy box | Switch tab; drag onto inner box | Greedy: outer text NOT updated; inner says "Dropped!". |
| DR-P4 | positive | Prevent Propagation — Not Greedy | Drag onto Not-Greedy inner | Both inner and outer say "Dropped!". |
| DR-P5 | positive | Revert Draggable — drops + reverts | Switch tab; drag `#revertable` to target then release outside | Item reverts to original position when not dropped on target. |
| DR-N2 | negative | Drop way off-target | Drag with massive offset | No "Dropped!" text update. |
| DR-V1 | validation | Recorded as Actions.dragAndDrop | Recorder | Java: `Actions.dragAndDrop(src, tgt).perform();`. |
| DR-DD | data-driven | See [DD-DR](#dd-droppable) | — | All tab × source × target combinations behave per spec. |

### 5.5 `/draggable`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| DG-P1 | positive | Free draggable moves both X and Y | dragAndDropBy(80, 80) | Element rect.x and rect.y both changed. |
| DG-P2 | positive | Axis-X restricted: only X changes | Switch tab; dragAndDropBy(50, 50) | rect.y unchanged; rect.x increased. |
| DG-P3 | positive | Axis-Y restricted: only Y changes | dragAndDropBy(50, 50) on Y-only | rect.x unchanged; rect.y increased. |
| DG-P4 | positive | Container-restricted: stays inside container | Drag with large offset | rect always inside its parent container. |
| DG-P5 | positive | Cursor style tab: cursor changes on drag start | Hover, mousedown | Computed cursor changes per the four examples (move/grab/grabbing). |
| DG-V1 | validation | Recorded as Actions.dragAndDropBy | Recorder | Java: `Actions.dragAndDropBy(el, dx, dy).perform();` |

---

<a id="6-book-store-application"></a>
## 6. Section — Book Store Application

Pages: `/login`, `/books`, `/profile`, `/book-store-api` (API documentation page).

> Setup: book-store needs a user account. Tests use `BOOKSTORE_USER` env var (default `zac-demo-user`) and `BOOKSTORE_PASS` (default `ZacDemo!1`). For CI, use a one-time signed-up account stored in the secret manager. **Never commit creds.**

### 6.1 `/login`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| LG-P1 | positive | Successful login | userName + password + click `#login` | URL changes to `/profile`. Username label visible. |
| LG-P2 | positive | "New User" navigates to register | Click `#newUser` | URL changes to `/register`. |
| LG-P3 | positive | Logout button on profile signs out | After login, click `#submit` (logout label) | URL back to `/login`. |
| LG-N1 | negative | Empty fields | Click Login | Both fields get `is-invalid`. |
| LG-N2 | negative | Wrong username | "no-such-user" + any pass | `#name` shows "Invalid username or password!". |
| LG-N3 | negative | Wrong password | Real user + wrong pass | Same error. |
| LG-N4 | negative | Username only, password empty | Pass empty | Password field `is-invalid`. |
| LG-E1 | edge | SQL-ish input | username `"' OR 1=1 --"` | Treated as wrong creds; no SQLi behaviour. |
| LG-E2 | edge | Whitespace username | "   " | Treated as wrong creds. |
| LG-V1 | validation | Login state survives reload | Login → reload page | Still on /profile (token in localStorage). |
| LG-V2 | validation | Logout clears localStorage token | After logout, inspect localStorage | `userID` / `expires` keys removed. |

### 6.2 `/books`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| BK-P1 | positive | List displays | Open page | Default 8 books visible (Git Pocket Guide, Learning JavaScript Design Patterns, …). |
| BK-P2 | positive | Search by title "Git" | Type in `#searchBox` | List filters to "Git Pocket Guide". |
| BK-P3 | positive | Search by author "Addy" | Type | One result. |
| BK-P4 | positive | Search by publisher "O'Reilly" | Type | Multiple results. |
| BK-P5 | positive | Click a book — opens detail | Click "Git Pocket Guide" | URL `/books?book=ISBN`; detail page shows ISBN/Title/SubTitle/Author/Publisher/Pages/Description. |
| BK-P6 | positive | Add to collection (auth needed) | After login, on detail click `#addNewRecordButton` | Alert "Book added to your collection." Profile collection contains the book. |
| BK-N1 | negative | Search returns 0 rows | "ZZZNOTFOUND" | "No rows found" indicator. |
| BK-N2 | negative | Add book unauthenticated | Without login, click `#addNewRecordButton` | Redirected to /login OR error message. |
| BK-N3 | negative | Add same book twice | Add Git twice | Second click shows "Book already present in your collection!". |
| BK-E1 | edge | Search query exactly matches | Search whole title | Single matching row. |
| BK-E2 | edge | Search clears on backspace | Type then Ctrl+A + Delete | All books restored. |
| BK-V1 | validation | Pagination at 5/10/20 rows-per-page | Click footer dropdown | Rows per page changes immediately. |

### 6.3 `/profile`

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| PR-P1 | positive | Logged-in profile shows username | After login | `#userName-value` reads the logged-in username. |
| PR-P2 | positive | Added books appear in collection | Add Git on /books then /profile | Row for Git visible. |
| PR-P3 | positive | Delete a book from collection | Click trash icon → confirm | Row removed; alert "Book deleted." |
| PR-P4 | positive | Delete All Books | Click `#submit[Delete All Books]` → confirm | Collection empty; "No rows found". |
| PR-P5 | positive | Go To Book Store button | Click `#gotoStore` | URL `/books`. |
| PR-N1 | negative | Visit /profile without login | Open in fresh session | Redirected to /login. |
| PR-N2 | negative | Delete cancel | Click delete → cancel modal | Row preserved. |
| PR-V1 | validation | Token expiry redirects to login | Manually clear localStorage `userID`, refresh | Redirected to /login. |

### 6.4 `/book-store-api` (Swagger / API docs)

| ID | Type | Scenario | Steps | Expected |
|---|---|---|---|---|
| API-P1 | positive | API docs page renders | Open `/swagger/` | Swagger UI loads with endpoint list. |
| API-P2 | positive | GET /BookStore/v1/Books returns book list | Try-it-out → Execute | 200; body has `books[]`. |
| API-P3 | positive | POST /Account/v1/Authorized — auth check | Body with valid creds → Execute | 200 with `true`. |
| API-N1 | negative | POST /Account/v1/Login — wrong pass | Body with bad creds | 401 + JSON error body. |
| API-V1 | validation | Generated API client matches schema | Inspect Swagger model | (Hand-verify column types; doc-only). |

> **Programmatic API tests** can be implemented separately (Karate / RestAssured / Pytest); not covered by Selenium Cucumber. Add a parallel `automation-suite/api/` task list.

---

<a id="cross-browser--responsive"></a>
## 7. Cross-browser & Responsive matrix

### Browsers

| Scenario set | Chrome | Firefox | Safari | Edge |
|---|---|---|---|---|
| Smoke (P1 of every page) | ✅ must run | ✅ must run | ✅ must run on macOS | ✅ must run on Windows |
| Full positive | ✅ | ✅ | optional | optional |
| Negative + edge | ✅ | partial — some `:invalid` styles differ | minimal | minimal |
| Drag & drop (`/droppable`, `/draggable`, `/sortable`, `/resizable`) | ✅ | ⚠️ Firefox HTML5 DnD differs — use `Actions.clickAndHold().moveByOffset()...release()` not `dragAndDrop()` | ⚠️ same | ✅ |
| Right-click (`/buttons` BT-P2) | ✅ | ✅ | Safari requires `--enable-legacy-context-click` and ContextMenuButtonEvent | ✅ |
| File upload (`/upload-download`, `/automation-practice-form`) | ✅ via `sendKeys` | ✅ via `sendKeys` | ✅ via `sendKeys` (NOT system dialog) | ✅ |
| Multi-window (`/browser-windows`) | ✅ | ✅ | Safari blocks popups by default — set `pref('com.apple.Safari.WebKitJavaScriptCanOpenWindowsAutomatically', true)` | ✅ |
| Frames (`/frames`, `/nestedframes`) | ✅ | ✅ | ✅ | ✅ |

### Viewports

| Page | Desktop 1920 | Laptop 1366 | Tablet 768 | Mobile 375 |
|---|---|---|---|---|
| Home / nav | ✅ | ✅ | left-nav collapses (hamburger) | left-nav as drawer |
| `/automation-practice-form` | ✅ | ✅ | fields stack 2-up | fields stack 1-up; submit button reachable after `removeAds()` |
| `/webtables` | ✅ | ✅ | horizontal scroll inside table | same |
| `/droppable`, `/draggable` | ✅ | ✅ | touch-events not exposed; tests use mouse synth | skip on real mobile |
| `/sortable` | ✅ | ✅ | OK with mouse synth | skip |
| `/modal-dialogs` | ✅ | ✅ | modal width = 90vw on mobile; `.modal-content` width assertion is relative | same |

---

<a id="data-driven-appendix"></a>
## 8. Data-driven variation appendix

### <a id="dd-text-box"></a>DD-TB — `/text-box`

| name | email | currentAddress | permanentAddress | expectedSuccess |
|---|---|---|---|---|
| Naysha Ingale | qa@example.com | 12 ZAC Lane, Pune | 221B Baker Street | true |
| Mira | mira@gmail.com | (empty) | (empty) | true |
| (empty) | qa@example.com | A | A | false (no name does NOT block submit but per recommendation must be required) |
| Bad email | not-an-email | A | A | false (field-error) |
| Łukáš Kovář | luk@example.com | 1 ulice 道 | 2 ulice 道 | true |
| 500-char name | qa@example.com | (500 'a's) | (500 'a's) | true |

### <a id="dd-checkbox"></a>DD-CB — `/checkbox`

| Action sequence | Expected result tokens |
|---|---|
| Expand all → click Home | home, desktop, notes, commands, documents, workspace, react, angular, veu, office, public, private, classified, general, downloads, wordfile, excelfile |
| Expand all → click Documents | documents, workspace, react, angular, veu, office, public, private, classified, general |
| Expand all → click Documents → uncheck Office | documents, workspace, react, angular, veu (Office children gone) |
| Expand all → click Word File only | wordfile |
| (none) | (empty) |

### <a id="dd-webtables"></a>DD-WT — `/webtables` add-form data set

| firstName | lastName | email | age | salary | department | expectedSuccess |
|---|---|---|---|---|---|---|
| Naysha | Ingale | naysha@example.com | 29 | 85000 | QA | true |
| Łukáš | Kovář | l.k@example.cz | 33 | 92000 | DEV | true |
| (empty) | Kim | kim@example.com | 30 | 50000 | Ops | false (firstName field-error) |
| Sam | (empty) | sam@example.com | 30 | 50000 | Ops | false |
| Sam | Doe | not-email | 30 | 50000 | Ops | false (email field-error) |
| Sam | Doe | sam@example.com | abc | 50000 | Ops | false (age field-error) |
| Sam | Doe | sam@example.com | 30 | 50000 | (empty) | false |
| Loop ×10 | "ZacUser{i}" | "u{i}@x.com" | 25 + i | 10000+i*1k | QA | all true; pagination triggers |

### <a id="dd-links"></a>DD-LK — `/links` API codes

| linkId | expectedStatus | expectedResponseSubstring |
|---|---|---|
| `#created` | 201 | "201 and status text Created" |
| `#no-content` | 204 | "204" |
| `#moved` | 301 | "301" |
| `#bad-request` | 400 | "400" |
| `#unauthorized` | 401 | "401" |
| `#forbidden` | 403 | "403" |
| `#invalid-url` | 404 | "404" |

### <a id="dd-forms"></a>DD-FM — `/automation-practice-form`

| firstName | lastName | email | gender | mobile | dob | subjects | hobbies | address | state | city | expectedModal |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Naysha | Ingale | naysha@example.com | Male | 9123456789 | 17 May 2000 | Maths | Reading | ZAC HQ | NCR | Delhi | true |
| Mira | Patel | mira@example.com | Female | 9988776655 | 01 Jan 1995 | Physics, Chemistry | Sports, Music | Pune | Uttar Pradesh | Lucknow | true |
| Alex | Doe | alex@example.com | Other | 9000000001 | 31 Dec 1985 | English | Sports, Reading, Music | Gurgaon | Haryana | Karnal | true |
| (empty) | (empty) | (empty) | (none) | (empty) | today | (empty) | (none) | (empty) | (none) | (none) | false (validation block) |
| Short | Mobile | sm@example.com | Male | 12345 | today | (empty) | (none) | a | NCR | Delhi | false (mobile too short) |
| Bad | Email | not-an-email | Male | 9123456789 | today | (empty) | (none) | a | NCR | Delhi | false |

### <a id="dd-date-picker"></a>DD-DT — `/date-picker`

| input | inputType | expectedValueContains |
|---|---|---|
| 10/05/2025 | date | 10/05/2025 |
| 12/31/2099 | date | 12/31/2099 |
| 01/01/1900 | date | 01/01/1900 |
| October 31, 2025 11:30 PM | date+time | October 31, 2025 11:30 PM |
| (cleared) | date | (empty) |

### <a id="dd-droppable"></a>DD-DR — `/droppable`

| tab | source | target | expectedTargetText |
|---|---|---|---|
| Simple | `#draggable` | `#droppable` | Dropped! |
| Accept | `#acceptable` | `#droppable` | Dropped! |
| Accept | `#notAcceptable` | `#droppable` | Drop here (unchanged) |
| Prevent Propagation (Greedy) | `#dragBox` | `#greedyDropBoxInner` | inner: Dropped!; outer: Outer droppable (unchanged) |
| Prevent Propagation (Not Greedy) | `#dragBox` | `#notGreedyInnerDropBox` | both inner and outer say Dropped! |
| Revert Draggable (Will revert) | `#revertable` | `#droppable` | Dropped! then revert |
| Revert Draggable (Not revert) | `#notRevertable` | `#droppable` | Dropped! and stays |

### Bookstore credentials matrix (DD-LG)

| user | pass | expectedRoute | expectedError |
|---|---|---|---|
| (env) `BOOKSTORE_USER` | (env) `BOOKSTORE_PASS` | /profile | — |
| zac-demo-user | wrong-password | /login | "Invalid username or password!" |
| no-such-user | anything | /login | "Invalid username or password!" |
| (empty) | (empty) | /login | both fields `is-invalid` |
| `' OR 1=1 --` | anything | /login | "Invalid username or password!" |

---

## 9. Implementation hints

* **Java + Cucumber suite** (`projects/demoqa/`): every scenario above maps onto an existing or new line in `src/test/resources/features/<section>.feature`. The page objects under `src/main/java/pages/` already cover the common interactions; new scenarios reuse those methods.
* **Locators**: every element addressed in this plan has a 5-tier chain in `src/main/resources/locators/<section>.json` (`data-testid → ARIA → CSS → XPath → visual`). When demoqa changes its DOM, the healer falls through automatically.
* **Reporting**: `Hooks.afterZac()` writes one row per scenario into `reports/scenario-results.jsonl`. The `SmokeAggregator` rolls them into `reports/smoke_test_results.json` with PASS / FAIL / HEALED counts that the Dashboard consumes.
* **Heal-validation scenarios** (one per section, suffix `@heal-validation`): each rotates a primary `data-testid` at runtime via `LocatorRepository.simulateUiBreak()` and asserts the heal log has a deliberate event for that element. They prove the fall-through layer works without needing to wait for demoqa to actually break.
* **Data-driven**: Cucumber `Examples:` tables consume the appendix above. Each row produces one scenario instance in Allure with the data values shown as parameters.
* **Cross-browser**: `ZAC_BROWSER=firefox mvn test`, `ZAC_BROWSER=chrome ZAC_HEADLESS=true mvn test`. Safari/Edge set up via the same env var (already wired in `support/ZacWorld.java`).
* **API tests** (Section 6.4): out of scope for the Selenium suite — implement separately (RestAssured / Karate). They are listed here so the catalogue is complete.

---

**Coverage summary:** 9 sections / 30 pages / 270+ scenarios across positive, negative, edge, boundary, validation, data-driven, cross-browser and responsive variants. ~70 of these are already wired into the live Java suite; the rest are ready to drop in following the same `Page → Steps → Feature` template.



