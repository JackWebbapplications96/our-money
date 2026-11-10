# Our Money

A simple household budget you can open on any phone or computer. Pick a month to see money in, money out and what's left over. Edit income, bills, spending money and one-offs (birthdays, Christmas) for the months they happen.

- **Hosting:** GitHub Pages (static files, free)
- **Storage and login:** the same Supabase project as Little Doses, so the same sign-in works

## What it does

- **Totals for the month:** money in, money out and left over.
- **Money in:** each income source. Tap an amount to change it for just that month, from that month on, or every month. Tap *Counted* to leave a source out of the totals (for example, app income you track but don't rely on).
- **Bills:** monthly bills grouped by category, each with a *Counted* switch.
- **Spending money:** your day-to-day allowance, also shown per week.
- **One-offs:** things that only happen in certain months, either every year or just once.
- **Left over each month:** a bar for each of the next 12 months, plus 12-month totals. Tap a bar to jump to that month.
- **My salary:** works out take-home pay from your salary and pension, using 2026/27 tax rates for England, Wales and Northern Ireland.

Each signed-in person has their own private budget. Nobody else can read it, not even other accounts in the same Supabase project.

## One-time setup

1. In Supabase, open **SQL Editor → New query**, paste the contents of [`budget.sql`](budget.sql) and click **Run**.
2. Turn on GitHub Pages for this repo: **Settings → Pages → Deploy from a branch → main / (root)**.
3. Open the site, sign in with your Little Doses email and password, then add it to your home screen. On iPhone use **Share → Add to Home Screen**, and in Chrome on Android use **⋮ → Add to Home screen**.

If there's no budget saved yet, the app offers to start a new one.

## Good to know

- Never commit your actual figures to this repo. It's public, and the code doesn't need them because the data lives in Supabase.
- Supabase pauses free projects after 7 days with no activity. If that happens, press **Restore** in the Supabase dashboard. No data is lost.
- The tax figures are estimates to help with planning. Check your payslip for the exact amounts.
