import { CONTENT_KEY, isAuthed, json, type Handler } from "../../../cf/lib";
import { DEFAULT_CONTENT, mergeContent, type SiteContent } from "../../../src/lib/site-content";

/** What /admin needs to decide between the login form and the editor. */
export const onRequestGet: Handler = async ({ request, env }) => {
  const configured = !!env.ADMIN_PASSWORD;
  const persistent = !!env.CONTENT;
  if (!(await isAuthed(request, env))) return json({ authed: false, configured, persistent });
  const stored = env.CONTENT ? ((await env.CONTENT.get(CONTENT_KEY, "json")) as Partial<SiteContent> | null) : null;
  return json({ authed: true, configured, persistent, content: mergeContent(DEFAULT_CONTENT, stored) });
};
