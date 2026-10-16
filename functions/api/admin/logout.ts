import { clearedCookie, json, type Handler } from "../../../cf/lib";

export const onRequestPost: Handler = async () => json({ ok: true }, 200, { "set-cookie": clearedCookie });
