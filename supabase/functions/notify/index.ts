// Supabase Edge Function "notify": sends a notification to the club's phones.
// Paste this into Supabase > Edge Functions > Deploy a new function > Via editor, name it "notify".
// Needs three secrets (Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
//
// The app calls it with { type, book_id }:
//   "book_open"     -> "Ny bog: <titel>"  (to everyone except the sender; admin or the person who added the book)
//   "rating_closed" -> "<titel>: 4,683"   (to everyone except the sender; admin only)
//   "test"          -> a test message to the sender's own phones
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.110.0";

const APP_URL = Deno.env.get("APP_URL") ?? "https://rasmusboas11.github.io/AI-Slop/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Scores with up to three decimals and a decimal comma, like in the app (4,683)
const fmtAvg = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0").replace(".", ",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is asking? Only signed-in members may send.
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return reply({ error: "Du skal være logget ind." }, 401);
    const { data: adminRow } = await db.from("club_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    const isAdmin = !!adminRow;

    const { type, book_id } = await req.json();
    webpush.setVapidDetails(
      Deno.env.get("VAPID_SUBJECT") ?? APP_URL,
      Deno.env.get("VAPID_PUBLIC_KEY")!,
      Deno.env.get("VAPID_PRIVATE_KEY")!,
    );

    let message: { title: string; body: string; url: string; tag: string };
    let recipients = db.from("push_subscriptions").select("id, endpoint, p256dh, auth, user_id");

    if (type === "test") {
      message = { title: "Holtebois Book Club", body: "Det virker! Her får du besked, når der sker noget i klubben.", url: APP_URL, tag: "test" };
      recipients = recipients.eq("user_id", user.id);
    } else {
      const { data: book } = await db.from("books")
        .select("id, title, author, rating_open, added_by_id, ratings(language, content)")
        .eq("id", book_id).maybeSingle();
      if (!book) return reply({ error: "Bogen findes ikke." }, 404);

      if (type === "book_open") {
        if (!book.rating_open) return reply({ error: "Bedømmelsen er ikke åben." }, 400);
        if (!isAdmin && book.added_by_id !== user.id) return reply({ error: "Kun admin eller den der tilføjede bogen." }, 403);
        message = {
          title: `Ny bog: ${book.title}`,
          body: `${book.author ? book.author + ". " : ""}Giv din bedømmelse af skriveri og indhold.`,
          url: `${APP_URL}#book=${book.id}`, tag: `open-${book.id}`,
        };
      } else if (type === "rating_closed") {
        if (book.rating_open) return reply({ error: "Bedømmelsen er stadig åben." }, 400);
        if (!isAdmin) return reply({ error: "Kun admin kan lukke bedømmelser." }, 403);
        const rs = (book.ratings ?? []) as { language: number; content: number }[];
        const avg = (xs: number[]) => xs.reduce((a, b) => a + Number(b), 0) / xs.length;
        const score = rs.length ? (avg(rs.map((r) => r.language)) + avg(rs.map((r) => r.content))) / 2 : null;
        message = {
          title: score == null ? book.title : `${book.title}: ${fmtAvg(score)}`,
          body: "Bedømmelsen er lukket. Se hvem gav hvad.",
          url: `${APP_URL}#book=${book.id}`, tag: `closed-${book.id}`,
        };
      } else {
        return reply({ error: "Ukendt type." }, 400);
      }
      recipients = recipients.neq("user_id", user.id); // the sender already knows
    }

    const { data: subs, error } = await recipients;
    if (error) return reply({ error: error.message }, 500);

    let sent = 0, removed = 0, failed = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60 * 24 },
        );
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { // the phone turned notifications off: forget it
          await db.from("push_subscriptions").delete().eq("id", s.id);
          removed++;
        } else failed++;
      }
    }));
    return reply({ sent, removed, failed });
  } catch (e) {
    return reply({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
