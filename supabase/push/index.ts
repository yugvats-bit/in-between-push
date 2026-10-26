// Supabase Edge Function: "push"
// Paste this whole file into Supabase → Edge Functions → Deploy a new function → Via Editor, name it: push
// Secrets needed (Edge Functions → Secrets): VAPID_PRIVATE_JWK, SEND_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ---- Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), Web Crypto only ----
const enc = new TextEncoder();
const b64u = (buf) => {
  let s = ""; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (str) => {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const concat = (...arrs) => {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}

async function encryptPayload(text, p256dhB64, authB64) {
  const uaPublic = unb64u(p256dhB64), authSecret = unb64u(authB64);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length; header.set(asPublic, 21);
  return concat(header, ct);
}

async function vapidAuth(endpoint, privateJWK, subject) {
  const jwk = typeof privateJWK === "string" ? JSON.parse(privateJWK) : privateJWK;
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const pub = b64u(concat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y)));
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + claims));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

async function sendWebPush(subscription, payloadObj, privateJWK, subject, ttl = 60) {
  const body = await encryptPayload(JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuth(subscription.endpoint, privateJWK, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body,
  });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  // ── a passerby's phone subscribes ──
  if (body.action === "subscribe") {
    const s = body.subscription;
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return json({ error: "bad subscription" }, 400);
    const { error } = await db.from("push_subscriptions").upsert(
      { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, location: String(body.location || "alley-1").slice(0, 60) },
      { onConflict: "endpoint" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // ── a passerby stops it ──
  if (body.action === "unsubscribe") {
    await db.from("push_subscriptions").delete().eq("endpoint", String(body.endpoint || ""));
    return json({ ok: true });
  }

  // ── the camera phone sends ──
  if (body.action === "send") {
    if (!body.secret || body.secret !== Deno.env.get("SEND_SECRET")) return json({ error: "wrong secret" }, 401);
    const loc = String(body.location || "alley-1");
    const { data: subs, error } = await db.from("push_subscriptions").select("*").eq("location", loc);
    if (error) return json({ error: error.message }, 500);

    const privateJWK = Deno.env.get("VAPID_PRIVATE_JWK")!;
    let sent = 0, removed = 0, failed = 0;
    await Promise.all((subs || []).map(async (s: any) => {
      try {
        const res = await sendWebPush(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          { title: String(body.title || "Seen."), body: String(body.body || "") },
          privateJWK, "mailto:yuganshi_vats@nid.edu", 60, // stale "Seen." is meaningless, so expire fast
        );
        if (res.status === 404 || res.status === 410) {
          await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          removed++;
        } else if (res.ok) sent++;
        else { failed++; console.log("push failed", res.status, await res.text()); }
      } catch (e) { failed++; console.log("push error", String(e)); }
    }));
    return json({ ok: true, subscribers: subs?.length || 0, sent, removed, failed });
  }

  // ── the camera phone asks how many are listening ──
  if (body.action === "count") {
    const { count } = await db.from("push_subscriptions").select("*", { count: "exact", head: true }).eq("location", String(body.location || "alley-1"));
    return json({ count: count || 0 });
  }

  return json({ error: "unknown action" }, 400);
});
