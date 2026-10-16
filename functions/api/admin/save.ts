import { CONTENT_KEY, isAuthed, json, type Handler } from "../../../cf/lib";
import { sanitizeContent } from "../../../src/lib/site-content";

export const onRequestPost: Handler = async ({ request, env }) => {
  if (!(await isAuthed(request, env))) return json({ error: "Not authorized." }, 401);
  if (!env.CONTENT) return json({ error: "No content store connected. Bind the CONTENT KV namespace." }, 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request." }, 400);
  }
  const clean = sanitizeContent(body);
  await env.CONTENT.put(CONTENT_KEY, JSON.stringify(clean));
  return json({ ok: true, content: clean });
};
