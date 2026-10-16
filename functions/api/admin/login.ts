import {
  FAIL_DELAY_MS, LOCKOUT_MINUTES, clearFailures, clientIp, isLockedOut, json, recordFailure,
  safeEqual, sessionCookie, type Handler,
} from "../../../cf/lib";

export const onRequestPost: Handler = async ({ request, env }) => {
  const password = env.ADMIN_PASSWORD;
  if (!password) return json({ error: "Admin is not configured. Set ADMIN_PASSWORD." }, 503);

  const ip = clientIp(request);
  if (await isLockedOut(env, ip)) {
    return json({ error: `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} min.` }, 429, {
      "retry-after": String(LOCKOUT_MINUTES * 60),
    });
  }

  let submitted = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    submitted = typeof body?.password === "string" ? body.password : "";
  } catch {
    /* empty body → fails the check below */
  }

  if (!safeEqual(submitted, password)) {
    await recordFailure(env, ip);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return json({ error: "Wrong password." }, 401);
  }
  await clearFailures(env, ip);
  return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env) });
};
