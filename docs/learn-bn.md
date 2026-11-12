# RepoPilot কীভাবে কাজ করে (বাংলায়)

## ১. Request কোথা দিয়ে ঢোকে
- **CLI:** `src/cli/main.ts` কমান্ড পড়ে (`check <folder | github:owner/repo>`)।
- **Web:** `web/src/main.ts`-এ ফর্ম submit হলে `parseGithubTarget` নাম যাচাই করে, তারপর scan চলে।

## ২. মূল logic কোথায়
- `src/core/checks.ts`: ১২টি পরীক্ষা। প্রতিটি শুধু file-এর নাম ও ছোট লেখা দেখে সিদ্ধান্ত দেয়। কোনো AI বা অনুমান নেই (deterministic: একই input, একই ফল)।
- `src/core/analyze.ts`: সব পরীক্ষা চালিয়ে ফল জড়ো করে।

## ৩. Data কোথা থেকে আসে
- `src/sources/local.ts`: কম্পিউটারের folder পড়ে। Symlink অনুসরণ করে না।
- `src/sources/github.ts`: GitHub-এর public API পড়ে। প্রথমে commit-এর SHA নেয়, তারপর সেই commit থেকেই file list ও README পড়ে। কোনো token নেই।
- ফল দেখানো: `src/report/markdown.ts` (লেখা) ও `web/src/view.ts` (browser, শুধু `textContent`)।

## ৪. Test কীভাবে চলে
`npm run verify` = type check, তারপর সব test। Test offline: GitHub-এর বদলে নকল fetch, ফাইল-ব্যর্থতার জন্য নকল file system। Linux CI-তে (`.github/workflows/ci.yml`) একই কমান্ড চলে।

## ৫. Deploy
`docs/deployment.md` দেখুন। এখনো deploy হয়নি।

## ৬. কিছু ভাঙলে কোথায় দেখবেন
- Scan-এ error বার্তা: `src/sources/github.ts` (`httpError`)।
- Report-এ অদ্ভুত লেখা: `src/report/markdown.ts`।
- Browser-এ কিছু আটকে গেলে: console-এ Content-Security-Policy ত্রুটি দেখুন (`web/index.html`-এর `<meta>`)।

## ৭. নিজেকে পরীক্ষা করুন (উত্তর দিতে পারলে ঠিক বুঝেছেন)
1. Browser কোন দুটি ওয়েবসাইটে যেতে পারে, আর কেন বাকিগুলো আটকায়?
2. কেন scan একটি নির্দিষ্ট commit SHA-তে বাঁধা?
3. File-এর নামে `<img onerror=...>` থাকলে কী হয়, আর কোন কোডে সেটা আটকায়?
4. Linux CI-তে symlink test কেন skip না হয়ে fail করে?
5. README "পাস" করা মানে কী নয়?
