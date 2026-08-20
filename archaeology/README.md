# Archaeology — recovering the 2014 Memory Bank

Dig performed 2026-08-20 (plan milestone M0). Verdict: **the archive's
intellectual asset — the human-made topic map — was fully recovered.**
Nothing needs to be re-segmented by hand.

## What was recovered, and from where

**The dataset** (`wayback/`): on 2016-05-18 the Internet Archive's crawler
captured the live JSONP responses of the 2014 site's CMS API
(`cms.cedricprice.com`, WordPress + JSON API plugin). Those captures contain:

- `interviews_20160518.json` — all **14 interviews** with interviewee
  identity, Vimeo video references, **182 timecoded topic segments**
  (SMPTE 25 fps), and **490 card placements with the full text of all
  204 reference cards embedded**.
- `terms_20160518.json` — the complete controlled vocabulary:
  **37 topics**.
- `pages_20160518.json` — the Colofon (credits) page.

Every interview was last modified December 2014 and the deployed front-end
was never changed after (the 2021 repair only swapped the intro video id),
so the 2016 capture is the **final state** of the archive, not a stale one.

Raw `.jsonp` files are byte-for-byte as served by web.archive.org; `.json`
files are the same with the JSONP callback wrapper stripped.
`tools/convert_2014.py` turns them into `content/` deterministically.

**The deployed 2021 front-end** (`deployed-2021/`): the built site as it
still served from www.cedricprice.com on the dig date — the "newer source"
whose repository was never found, preserved in built form. Includes the
four Apercu webfont cuts the site shipped.

**Live-server findings** (`live-cms/`):

- `cms.cedricprice.com` still answers but every PHP request returns an
  empty HTTP 500: the host (**Hostnet**) now runs PHP 8.1 under a
  2014-era WordPress. The database is almost certainly intact behind it.
- Static files still serve (verified against `wp-includes/`), so the
  WordPress uploads are still on disk — but filenames can't be listed
  from outside.

## The one loss, and its recovery route

**Card images.** Cards had WordPress featured images, delivered only
through an API field the crawler never captured, and card texts embed no
image URLs. Everything textual survived; the images did not.

Route: whoever holds (or can recover) the **Hostnet account** for
cedricprice.com can pull a full backup — database + `wp-content/uploads/`
— which contains every card image and would also double-check the dataset
against the live DB. Worth doing once, soon, before the account lapses;
after that the loss becomes permanent.

## Sources consulted

- Wayback CDX index + captures for `cms.cedricprice.com` (3 API captures,
  2016-05-18; robots.txt 2017; homepage 2019)
- Live probes of `cms.cedricprice.com` (HTTP, curl, 2026-08-20)
- Live download of `www.cedricprice.com` (HTTPS, 2026-08-20)
- The 2014 source folder (`cpmb-2014/`, outside this repo) for endpoint
  URLs, the colour system, and the identity styles
