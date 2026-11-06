# 📚 Holtebois Book Club

An app for our book club: keep track of the books we've read and give each one
a score from 1,0 to 5,0 (with one decimal, like 4,2) for **Language** and **Content**. Every member gives their
own score, and the app shows the club's average.

- Add books by **searching the internet**, Danish books included (Apple Books' Danish e-books and audiobooks, Open Library and Google Books) with suggestions as you type, or by typing them in
- Every new book starts a **rating round**: all members give their score until the admin closes it, and then the score is final
- A **Statistics** page with the top rated books, best language, best content, most divided opinions and most active readers
- Add a **picture** of the book: the cover from the search, or a photo from your phone
- Sort by best language, best content, best overall or when you read it
- Members **create their own login** (email + password) with a **profile picture**, and each person can only change their own scores
- Each book can show **who selected it** and **where the club reviewed it**
- Members score with one decimal (4,2); averages and final scores show up to three decimals (4,683)
- Works in any browser, and on iPhone it can be **added to the home screen** like a normal app

It's plain HTML, CSS and JavaScript with nothing to install or build.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page layout |
| `styles.css` | Colours and layout (light and dark mode) |
| `app.js` | Everything the app does |
| `config.js` | **Your settings**: club name and database keys |
| `supabase/schema.sql` | Creates the database tables |
| `supabase/002_rating_rounds_and_admin.sql` | Adds rating rounds and the club admin |
| `supabase/003_decimal_scores.sql` | Allows scores with one decimal (4,2) |
| `supabase/004_import_old_ratings.sql` | Lets the admin import old ratings for members without an account (includes 003) |
| `supabase/005_selected_by_location_profiles.sql` | Adds "Selected by", review location and profile pictures |
| `manifest.webmanifest`, `icon.svg` | Let the app be installed on a phone |

## 1. Try it on your computer

Out of the box, books are saved in your own browser only. That's handy for trying things out.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## 2. Share with your club (free Supabase database)

1. Create a free account at https://supabase.com and make a **New project**.
2. In the project, open **SQL Editor → New query**, paste everything from
   `supabase/schema.sql`, and press **Run**. Then do the same with
   `supabase/002_rating_rounds_and_admin.sql`, `supabase/004_import_old_ratings.sql` and
   `supabase/005_selected_by_location_profiles.sql`.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. Paste them into `config.js`:

   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```

5. Open **Authentication → URL Configuration** and set **Site URL** to the app's
   address (your GitHub Pages link from step 3 below). Add the same address under
   **Redirect URLs**. The links in sign-up and password-reset emails go there.

Now the app opens with a **Sign in / Create account** screen. Each member makes their
own login, and everyone sees the same books and scores.

> The anon key is *meant* to be public, so it's fine to have it in GitHub. The database
> only lets signed-in members see or change anything, and only lets each person change
> their own scores.

**Logins, good to know**

- New members get an email to confirm their address before they can sign in.
  (You can turn that off under **Authentication → Sign In / Providers → Email → Confirm email**.)
- "Forgot password?" on the sign-in screen sends a reset link by email.
- Want only your club to join? Once everyone has an account, turn off
  **Allow new users to sign up** under **Authentication → Sign In / Providers**.
  You can still invite people later from **Authentication → Users → Invite user**.
- Supabase's built-in email service only sends a few emails per hour. That's fine for
  a book club; for more, connect your own email provider under **Authentication → Emails**.

**The admin**

The person who created the first account becomes the club admin when you run
`002_rating_rounds_and_admin.sql` (the query shows who it is at the end). The admin
can close a book's rating round (scores are then final), reopen it, and delete any book.
To make someone else admin, run this in the SQL Editor with their email:

```sql
insert into club_admins (user_id) select id from auth.users where email = 'their@email.com';
```

**Importing old ratings**

As admin, tap your name → **📋 Import old ratings** and paste text like this (several books at once is fine):

```
Khaled Hosseini - Drageløberen:
Jasp:
Indhold: 4.3
Skriveri: 4.8
```

"Indhold" is Content and "Skriveri" is Language. The book is saved with rating closed. When a member
later creates an account with the same name (e.g. "Jasp"), their imported scores are linked to them.

**Better Google Books results (optional)**

Google Books often refuses searches without a key. The app works without it, but you can
add a free key: create one at https://console.cloud.google.com (enable "Books API",
then Credentials → Create API key) and put it in `config.js` as `googleBooksApiKey: "..."`.

## 3. Put it online (free with GitHub Pages)

1. Push these files to the GitHub repo.
2. On GitHub, go to **Settings → Pages**, pick **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
3. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## 4. Put it on your iPhone

Open the GitHub Pages link in **Safari**, tap **Share → Add to Home Screen**.
The app now has its own icon and opens full-screen, like a normal app.

## Ideas for later

- A real iPhone app (Swift/SwiftUI) using the same Supabase database
- "Next book" voting, meeting dates, favourite quotes
