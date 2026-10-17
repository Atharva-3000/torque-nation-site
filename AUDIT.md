# Site audit: design + SEO (16 Oct 2026)

Two passes over the public site: a design audit against the `design-taste-frontend` rules, and an SEO audit. Lazyweb's Growth Score only grades live public URLs, so it could not score this local build. Re-run it once the domain is live. Admin pages are out of scope for the design rules (they cover marketing pages, not dashboards).

**Design read:** premium local workshop site for 450cc+ owners in and around Ratlam, dark industrial-precision language, native CSS. Dials: variance 6, motion 4, density 4.

## Design: found and fixed

| Finding | Fix |
|---|---|
| Hero tachometer geometrically broken: redline arc not on the scale's radius, needle overshooting, gauge clipped by the readout | Rebuilt as server-rendered SVG from one angle function (`gaugeSvg()` in `lib/render.js`). Logo mark had the same bug; redrawn. |
| Hero had no real visual | Hero now uses a photo (Panigale V4, CC0) set in Admin → Settings; falls back to the gauge if removed |
| Eyebrow label above 7 of 8 home sections | Cut to 2 on home, 1 per inner page |
| "Big headline left, small paragraph right" split headers (4×) | Stacked headline + lede |
| Three equal class cards | Replaced with a sticky finder + photo rows (one layout family used once) |
| Number badges (01-06) on cards and service categories | Removed; kept only on the real 4-step process |
| Brand wall printed category labels under logos; text wordmarks only | Logo-only tiles with 7 official logos; 3 brands without a source file stay as wordmarks |
| 6 different labels for the same two CTAs | "Book a service" and "WhatsApp us" everywhere |
| Hero subtext 33 words | 18 words |
| En/em dashes and ellipses in visible copy (ranges, hours, placeholders) | Zero left; DB values migrated too |
| Invented number ("50-point check") | Rewritten without a number |
| `window.addEventListener('scroll')` for the header | IntersectionObserver sentinel |
| Brand grid left an orphan tile at tablet width | 2 columns on phones, 5 from 640px |

Kept deliberately: dark-only theme (brand decision documented in DESIGN-SYSTEM.md), the single model-name marquee, the tick-scale texture.

## SEO: found and fixed

| Finding | Fix |
|---|---|
| No canonical, `og:url`, `og:image`, Twitter card, apple-touch-icon, manifest | All added. Canonical uses Settings → Live website address |
| Titles repeated "Ratlam" or lacked keywords | Rewritten, 45-55 chars, "superbike / service / Ratlam" led |
| Home and Services descriptions over 160 chars; Work and Contact too thin | All 114-153 chars |
| Home H1 had no location | H1 now includes "Superbike workshop in Ratlam" |
| JSON-LD: `openingHours` was free text (invalid), placeholder phone/address emitted | Valid `Mo-Sa 10:00-19:30`, placeholders omitted, added `@id`, url, image, priceRange, areaServed cities, geo + sameAs when set |
| No breadcrumbs or FAQ markup | BreadcrumbList on inner pages; FAQ section + FAQPage on /pricing, answers generated from the live rate card |
| HEAD requests returned 404 | Pages answer HEAD |
| Empty /work page indexable | `noindex` + left out of sitemap until a published job exists |
| robots/sitemap used request host | Use the configured live address |

## Still to do (needs you)

1. **Google Business Profile.** This is the biggest local-SEO lever. Name, address and phone must match Settings exactly.
2. **Real NAP in Settings:** phone, WhatsApp, street address, Maps link, lat/long, live website address.
3. **Real photos:** your workshop and customer bikes (with permission) should replace the Commons photos over time. Upload in Settings and Portfolio.
4. **Portfolio:** publish 3+ jobs so /work gets indexed.
5. **Logos for Crank1, SW-Motech and RCB:** ask your distributor for the files and upload them in Admin → Brands.
6. **Self-host fonts** before launch (Google Fonts is render-blocking).
7. **Optional content pages** that rank well locally: one page per popular model ("Himalayan 450 service in Ratlam", "ZX-10R service") and one per nearby city (Ujjain, Mandsaur, Neemuch).
