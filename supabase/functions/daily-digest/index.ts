// Mock supabase client definition for Deno Edge Function
declare const supabase: any;
declare const Deno: any;

async function getRoomsToDigest(targetHourUtc: number) {
  return supabase
    .from("rooms")
    .select("id, created_by, users!inner(timezone, midnight_utc_hour)")
    .filter("users.midnight_utc_hour", "eq", targetHourUtc)
}

function parseDigestSafely(rawString: string) {
  try {
    return JSON.parse(rawString);
  } catch (e) {
    const jsonMatch = rawString.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch {}
    }
    return { headline: "Partial Summary Generated", raw_fallback: rawString };
  }
}

// Handler logic here...
export const serve = async (req: Request) => {
  const currentUtcHour = new Date().getUTCHours();
  const rooms = await getRoomsToDigest(currentUtcHour);
  
  if (!rooms?.data || rooms.data.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }));
  }

  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAiKey) {
    return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY secret" }), { status: 500 });
  }

  let processedCount = 0;
  for (const room of rooms.data) {
    // 1. Fetch recent messages
    const { data: messages } = await supabase
      .from('messages')
      .select('content, sender_type')
      .eq('room_id', room.id)
      .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(100);

    if (!messages || messages.length === 0) continue;

    // 2. Synthesize with OpenAI
    const chatLog = messages.map((m: any) => `${m.sender_type}: ${m.content}`).join('\n');
    const prompt = `You are an AI assistant. Summarize the following brainstorming room chat log from the past 24 hours into a concise JSON object with a single "headline" key. \n\nChat Log:\n${chatLog}`;

    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openAiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: 'system', content: prompt }],
          max_tokens: 100
        })
      });

      const json = await res.json();
      const rawString = json.choices?.[0]?.message?.content || "{}";
      const digest = parseDigestSafely(rawString);

      // 3. Inject summary message into the room pretending to be the agent
      await supabase.from('messages').insert({
        room_id: room.id,
        sender_type: 'agent',
        sender_name: 'Daily Digest Engine',
        content: `**24H Summary:** ${digest.headline || "Active brainstorming occurred."}`
      });

      processedCount++;
    } catch (err) {
      console.error("Failed to digest room", room.id, err);
    }
  }

  return new Response(JSON.stringify({ processed: processedCount }));
}
