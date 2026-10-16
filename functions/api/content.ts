import { CONTENT_KEY, json, type Handler } from "../../cf/lib";
import { DEFAULT_CONTENT, mergeContent, type SiteContent } from "../../src/lib/site-content";

/** Homepage copy as edited in /admin, merged over the shipped defaults. */
export const onRequestGet: Handler = async ({ env }) => {
  const stored = env.CONTENT ? ((await env.CONTENT.get(CONTENT_KEY, "json")) as Partial<SiteContent> | null) : null;
  return json(mergeContent(DEFAULT_CONTENT, stored), 200, {
    "cache-control": "public, max-age=60",
  });
};
