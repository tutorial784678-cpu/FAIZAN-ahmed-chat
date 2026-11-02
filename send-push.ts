import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Missing user authorization" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return json({ error: "VAPID secrets are not configured" }, 503);

  const token = authorization.slice("Bearer ".length);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return json({ error: "Invalid user session" }, 401);
  const senderId = authData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { event_type?: string; event_id?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body.event_type || !body.event_id || !["message", "call"].includes(body.event_type)) {
    return json({ error: "event_type must be message or call, and event_id is required" }, 400);
  }

  let conversationId = "";
  let title = "";
  let message = "";
  let kind = body.event_type;
  let notificationUrl = "/";
  let recipientIds: string[] = [];
  let eventId = String(body.event_id);

  const { data: senderProfile } = await admin.from("profiles")
    .select("display_name,username,avatar_url").eq("id", senderId).maybeSingle();
  const senderName = senderProfile?.display_name || senderProfile?.username || "Someone";

  if (body.event_type === "message") {
    const { data: row, error } = await admin.from("messages")
      .select("id,conversation_id,sender_id,body,media_type,file_name")
      .eq("id", body.event_id).maybeSingle();
    if (error || !row || row.sender_id !== senderId) return json({ error: "Message not found or not owned by sender" }, 403);
    conversationId = row.conversation_id;
    const { data: members, error: memberError } = await admin.from("conversation_members")
      .select("user_id").eq("conversation_id", conversationId).neq("user_id", senderId);
    if (memberError) return json({ error: "Could not find conversation recipients" }, 500);
    recipientIds = (members || []).map((item: { user_id: string }) => item.user_id);
    title = senderName;
    message = row.body?.slice(0, 180) || (row.file_name ? `Sent a file: ${row.file_name}` : "Sent an attachment");
    notificationUrl = "/";
  } else {
    const { data: row, error } = await admin.from("call_signals")
      .select("id,conversation_id,sender_id,recipient_id,signal_type,payload")
      .eq("id", body.event_id).maybeSingle();
    if (error || !row || row.sender_id !== senderId || row.signal_type !== "offer") {
      return json({ error: "Call offer not found or not owned by sender" }, 403);
    }
    conversationId = row.conversation_id;
    recipientIds = [row.recipient_id];
    eventId = String(row.id);
    title = row.payload?.video ? `Incoming video call from ${senderName}` : `Incoming audio call from ${senderName}`;
    message = row.payload?.video ? "Tap to open and answer the video call." : "Tap to open and answer the audio call.";
    notificationUrl = `/?incomingCallSignal=${encodeURIComponent(eventId)}&callAction=answer`;
  }

  if (!recipientIds.length) return json({ ok: true, sent: 0, reason: "No recipients" });
  const { data: subscriptions, error: subscriptionError } = await admin.from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,notify_messages,notify_calls,sound_enabled")
    .in("user_id", recipientIds);
  if (subscriptionError) return json({ error: "Could not load recipient subscriptions" }, 500);

  const eligible = (subscriptions || []).filter((sub: any) =>
    body.event_type === "call" ? sub.notify_calls !== false : sub.notify_messages !== false
  );
  if (!eligible.length) return json({ ok: true, sent: 0, reason: "Recipients have no enabled push subscription" });

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  let sent = 0;
  let failed = 0;
  for (const sub of eligible as any[]) {
    const payload = JSON.stringify({
      title,
      body: message,
      kind,
      eventId: body.event_type === "call" ? eventId : null,
      conversationId,
      url: notificationUrl,
      sound: sub.sound_enabled !== false,
    });
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, payload, { TTL: body.event_type === "call" ? 60 : 60 * 60, urgency: body.event_type === "call" ? "high" : "normal" });
      sent++;
    } catch (error) {
      failed++;
      const statusCode = (error as any)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      }
      console.warn("Push delivery failed", statusCode || "unknown");
    }
  }
  return json({ ok: true, sent, failed, kind, conversationId });
});
