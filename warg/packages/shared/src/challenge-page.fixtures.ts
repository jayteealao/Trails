/**
 * Recorded page shapes for the challenge-page detector.
 *
 * Three are bot-wall interstitials that a site serves instead of the article;
 * four are real pages that must still be archived. Every token, ray id, cookie
 * and site name of the captured samples is replaced by a placeholder.
 */

// Cloudflare managed challenge: modelled on a sample captured on 2026-11-07, identifiers replaced.
export const CLOUDFLARE_CHALLENGE_PAGE =
  '<!DOCTYPE html><html lang="en-US"><head><title>Just a moment...</title>' +
  '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
  '<meta name="robots" content="noindex,nofollow">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>*{box-sizing:border-box;margin:0;padding:0}html{line-height:1.15}body{display:flex;flex-direction:column}</style>' +
  '</head><body>' +
  '<div class="main-wrapper" role="main"><div class="main-content">' +
  '<noscript><div class="h2"><span id="challenge-error-text">Enable JavaScript and cookies to continue</span></div></noscript>' +
  '<h1 id="challenge-title" class="h1">example.com</h1>' +
  '<p id="challenge-body-1" class="h2 spacer-bottom">Verifying you are human. This may take a few seconds.</p>' +
  '<div id="challenge-error-text"></div>' +
  '<div id="challenge-stage"></div>' +
  '</div></div>' +
  "<script>(function(){window._cf_chl_opt = { cType: 'managed', cRay: 'RAY_ID', cZone: 'example.com', cH: 'TOKEN' };" +
  "var cpo=document.createElement('script');" +
  "cpo.src='/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=RAY_ID';" +
  'document.getElementsByTagName(\'head\')[0].appendChild(cpo);}());</script>' +
  '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=RAY_ID"></script>' +
  '<div class="footer" role="contentinfo"><div class="footer-inner">' +
  '<div class="text-center">Ray ID: <code>RAY_ID</code></div>' +
  '<div class="text-center">Performance &amp; security by Cloudflare</div>' +
  '</div></div>' +
  '</body></html>';

// DataDome challenge: modelled on a sample captured on 2026-11-07, identifiers replaced.
export const DATADOME_CHALLENGE_PAGE =
  '<html lang="en"><head><title>example.com</title>' +
  '<style>#cmsg{animation: A 1.5s;}@keyframes A{0%{opacity:0;}99%{opacity:0;}100%{opacity:1;}}</style>' +
  '</head><body style="margin:0">' +
  '<p id="cmsg">Please enable JS and disable any ad blocker</p>' +
  "<script data-cfasync=\"false\">var dd={'rt':'c','cid':'CID','hsh':'HASH','t':'fe','s':0,'e':'TOKEN','host':'geo.captcha-delivery.com','cookie':'COOKIE'}</script>" +
  '<script data-cfasync="false" src="https://ct.captcha-delivery.com/c.js"></script>' +
  "<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');" +
  "d.innerHTML=\"window.__CF$cv$params={r:'RAY_ID',t:'TOKEN'};var a=document.createElement('script');" +
  "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);\";" +
  "b.getElementsByTagName('head')[0].appendChild(d)}}var a=document.createElement('iframe');a.height=1;a.width=1;" +
  "a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';" +
  'document.body.appendChild(a);c();})();</script>' +
  '</body></html>';

// PerimeterX challenge: modelled on a sample captured on 2026-11-07, identifiers replaced.
export const PERIMETERX_CHALLENGE_PAGE =
  '<!DOCTYPE html><html lang="en"><head>' +
  '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<meta name="description" content="px-captcha">' +
  '<title>Access to this page has been denied</title>' +
  '</head><body>' +
  "<script>window._pxAppId = 'PXAPPID'; window._pxJsClientSrc = '/PXAPPID/init.js';" +
  "window._pxHostUrl = '/PXAPPID/xhr'; window._pxreCaptchaTheme = 'light';" +
  "var s = document.createElement('script'); s.src = '/PXAPPID/captcha/captcha.js?a=c&u=UUID&v=&m=0';" +
  'document.head.appendChild(s);</script>' +
  '<div class="px-captcha-error-container"><div class="px-captcha-error-wrapper">' +
  '<div class="px-captcha-error-header"></div>' +
  '<div class="px-captcha-error-message"></div>' +
  '<div id="px-captcha"></div>' +
  '</div></div>' +
  '</body></html>';

// A real article about bot walls that quotes every vendor marker as text: it must be archived.
export const ARTICLE_ABOUT_CHALLENGES =
  '<!DOCTYPE html><html lang="en"><head><title>Why your reader keeps saying "Just a moment..."</title></head><body>' +
  '<header><nav><a href="/">Home</a> <a href="/archive">Archive</a></nav></header>' +
  '<article><h1>Why your reader keeps saying "Just a moment..."</h1>' +
  '<p>If you save articles for later, you have probably opened one and found a page that says "Just a moment..." ' +
  'instead of the story you wanted. That page is not the article. It is an interstitial that a bot wall serves ' +
  'while it decides whether the visitor is a person, and a read-later tool that fetches pages without a full ' +
  'browser can end up keeping the interstitial in place of the text it was asked to save.</p>' +
  '<p>Three vendors account for most of the walls we see. The first shows a spinner and a short note asking you to ' +
  'wait while it verifies that you are human. The second shows one line asking you to enable JavaScript and to ' +
  'disable any ad blocker. The third shows a heading that reads "Access to this page has been denied" above a ' +
  'button you are meant to press and hold. Each of them answers with very little visible text, and each of them ' +
  'loads a script from its own host to run the check.</p>' +
  '<p>The markup gives them away. A managed challenge sets a global options object before it loads its ' +
  'orchestrator script, a second vendor writes a small configuration object that names its captcha host, and the ' +
  'third tags its error wrapper with a class name of its own. Here is what those pieces look like when you view ' +
  'the source of a blocked page:</p>' +
  '<pre><code>&lt;script&gt;window._cf_chl_opt = {...}&lt;/script&gt;\n' +
  '&lt;script&gt;var dd = { host: "geo.captcha-delivery.com" }&lt;/script&gt;\n' +
  '&lt;div class="px-captcha-error-wrapper"&gt;&lt;/div&gt;</code></pre>' +
  '<p>None of these markers is a problem on its own. Plenty of ordinary pages load a vendor sensor script on every ' +
  'visit, so the presence of a captcha host in the page is not proof that the visitor was stopped. What marks an ' +
  'interstitial is the combination: a challenge marker in the markup and almost nothing for a reader to read. A ' +
  'real article has paragraphs; a challenge page has a sentence at most.</p>' +
  '<p>What should a read-later tool do when it meets one? It should not pretend the save worked. The honest answer ' +
  'is to record that the site blocked access, keep nothing, and tell the reader, so that they can open the link in ' +
  'their own browser where the check can pass. Retrying the same fetch a moment later rarely helps, because the ' +
  'wall is reacting to the kind of client, not to a passing fault, and a tool that hammers the site only makes ' +
  'the next check stricter.</p>' +
  '<p>There is a cost to being careful, too. A detector that looks only for the words on the page will flag this ' +
  'very article, which says "Just a moment..." and "Access to this page has been denied" more than once. That is why ' +
  'the check has to read structure rather than prose: the words a writer quotes are text, while the markers a ' +
  'vendor plants are tags and scripts. Telling the two apart is the whole difference between a useful warning ' +
  'and a tool that refuses to save the articles that explain the problem.</p>' +
  '<p>So the next time your reader shows you a spinner and a ray id instead of a story, you will know what ' +
  'happened, and you will know that the fix is to open the page yourself rather than to save it again.</p>' +
  '</article>' +
  '<footer><p>Posted in Tools. Comments are closed.</p></footer>' +
  '</body></html>';

// A real page with a thin body and the Cloudflare bot-score injector: modelled on a sample captured on 2026-11-07, identifiers replaced.
export const THIN_PAGE_WITH_CLOUDFLARE_SCRIPT =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Test page</title></head><body>' +
  '<div id="app"><h1>Test page</h1><p>Your browser passed the checks.</p></div>' +
  "<script>(function(){function c(){var b=a.contentDocument||a.contentWindow.document;if(b){var d=b.createElement('script');" +
  "d.innerHTML=\"window.__CF$cv$params={r:'RAY_ID',t:'TOKEN'};var a=document.createElement('script');" +
  "a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';document.getElementsByTagName('head')[0].appendChild(a);\";" +
  "b.getElementsByTagName('head')[0].appendChild(d)}}var a=document.createElement('iframe');a.height=1;a.width=1;" +
  "a.style.position='absolute';a.style.top=0;a.style.left=0;a.style.border='none';a.style.visibility='hidden';" +
  'document.body.appendChild(a);c();})();</script>' +
  '</body></html>';

// A thin real page whose Cloudflare bot-score injector uses the versioned /h/<x>/scripts/jsd/ path: authored, not captured; the path shape is unconfirmed.
export const THIN_PAGE_WITH_VERSIONED_CLOUDFLARE_SCRIPT =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Short note</title></head><body>' +
  '<main><h1>Short note</h1><p>We moved this page to a new address.</p></main>' +
  "<script>(function(){var a=document.createElement('script');" +
  "a.src='/cdn-cgi/challenge-platform/h/b/scripts/jsd/RAY_ID/main.js';" +
  "document.getElementsByTagName('head')[0].appendChild(a);})();</script>" +
  '</body></html>';

// A normal article whose site also loads vendor bot sensors on every page: modelled on samples captured on 2026-11-07, identifiers replaced.
export const LONG_PAGE_WITH_VENDOR_SENSOR =
  '<!DOCTYPE html><html lang="en"><head><title>A slow week for the harbour ferries</title>' +
  "<script>window._pxAppId = 'PXAPPID';</script>" +
  '<script src="https://ct.captcha-delivery.com/tags.js" async></script>' +
  '</head><body>' +
  '<article><h1>A slow week for the harbour ferries</h1>' +
  '<p>The harbour ferries ran a reduced timetable for most of the week after two of the four boats were taken out ' +
  'of service for their annual inspection. Commuters on the early crossing reported queues on the pier that ' +
  'stretched past the ticket office, and the operator added a bus link from the north terminal to carry the ' +
  'overflow into the centre of town.</p>' +
  '<p>The inspection is routine. Each boat is lifted out of the water, its hull is checked for corrosion, and its ' +
  'engines are stripped down and rebuilt where the logs show heavy wear. This year the work took longer than ' +
  'planned because a shipment of replacement bearings arrived late, and the yard would not return a boat to the ' +
  'water until every part on the list had been fitted and signed off by the surveyor.</p>' +
  '<p>Regular passengers took the delay in their stride. Several said that the bus link was slower but more ' +
  'comfortable than the crowded deck, and a few used the week as a reason to cycle the long way round the bay. ' +
  'Shops near the north terminal said trade was up, as people who would normally have walked straight onto a boat ' +
  'stopped for coffee while they waited for the next departure.</p>' +
  '<p>The operator has promised a full timetable from Monday. Both boats passed their inspections on Friday ' +
  'afternoon, and crews spent the weekend on trial runs across the harbour to bed in the rebuilt engines. A ' +
  'spokesperson said the company would review how it schedules the work, so that next year only one boat is out of ' +
  'service at a time and the busiest crossings keep their usual frequency.</p>' +
  '<p>For now the advice is simple: check the departure board before you leave home, allow extra time for the ' +
  'first crossing of the day, and keep the bus link in mind if the pier looks busy. The council has also asked ' +
  'drivers to avoid the terminal car park during the morning peak, when the shuttle buses need the turning space ' +
  'to load passengers quickly and keep to their own timetable.</p>' +
  '<p>Longer term, the harbour board is studying whether a fifth boat would pay for itself. A report due in the ' +
  'spring will compare the cost of a new vessel with the cost of running a permanent bus link, and it will set out ' +
  'what each option would mean for fares and for the number of crossings on the busiest routes.</p>' +
  '<p>Passenger groups have asked for a seat at the table while the study runs. They want the board to count the ' +
  'people who already avoid the morning boats because of the crowds, and to publish the survey data it collects ' +
  'so that riders can check the figures for themselves before any decision on fares is made.</p>' +
  '</article></body></html>';

// A plain article with no vendor markup at all.
export const NORMAL_ARTICLE_PAGE =
  '<!DOCTYPE html><html lang="en"><head><title>Notes on sourdough</title></head><body>' +
  '<article><h1>Notes on sourdough</h1>' +
  '<p>A starter needs flour, water and patience. Feed it at the same time each day and it will rise and fall on a ' +
  'schedule you can plan a bake around.</p>' +
  '<p>Keep the dough warm during the first rise. A cold kitchen does not stop the yeast, but it slows it enough to ' +
  'double the time the dough needs.</p>' +
  '<p>Bake in a covered pot for the first half of the bake, then uncover it so the crust can brown.</p>' +
  '</article></body></html>';
