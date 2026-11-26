# MOVA Coffee · to-do list

Ideas agreed with William to build later. Newest at the top.

## In progress
- **Wallet card (Apple Wallet / Google Wallet) via Passcreator.** The card shows name, stamps (e.g. 2/3), free coffees, Mover type and any discount, with the same QR the till scans; it updates after every stamp. See SETUP.md part 7.

## Before the Wallet card goes live to customers
- **Apple Developer account (about £79/year).** Needed so iPhone Wallet cards are signed with MOVA's own certificate instead of Passcreator's demo certificate (demo is limited to 30 passes). Creating a new Apple Account with movacoffeehouse@gmail.com failed on 2026-11-26 ("Your account can't be created at this time"). Next time: try again on a different network, outside private browsing, with no VPN, or on an iPhone/iPad/Mac. Fallback: enrol as an individual with William's personal Apple ID (customers still only see "MOVA Coffee"). Once approved: create a Pass Type ID certificate, upload it to the Passcreator template, and re-add any test cards.

## Later: staff
- **Shift log per barista.** Record when each barista signs in on the till (name + PIN) and when they sign out or switch, so the owner can see shift start and end times.
- **Scans per barista per shift/day.** On /admin, show how many cards each barista scanned that day (stamps added, free coffees used), using the shift log above. Stamps already record which barista added them (`stamps.staff_member_id`), so daily counts are possible now; per-shift needs the shift log.
- **Customer reviews of the barista.** Let customers leave a review (rating and comment) after a visit. Link each review to the barista who was signed in on the till at that time (from the shift log) and to the shop. Show reviews to the owner on /admin.

## Later: website and MOVA Miles
- Privacy page: fill in company name and number, and the publish date.
- Google review link: replace the Google Maps search in "Review us" with the Business Profile review link.
- Real coffee photo for the "Coffee that keeps you moving" section (still an AI image).
- Counter sign / poster: "Join MOVA Miles: 3 coffees, the 4th is on us", plus the 20% tenant offer.
- Decide on "MOVA at home, coming soon" (beans).
- Optional: automatic clean-up of cards unused for 24 months (the privacy page says so; nothing does it yet).
- Later hardware: shared shop phone or tablet, plus a 2D QR scanner.
