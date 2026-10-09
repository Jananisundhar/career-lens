import type { Config, Context } from "@netlify/edge-functions";

// Mirrors Flask's @login_required: logged-out visitors are sent to /login,
// and logged-in visitors to "/" go straight to the dashboard.
// The API still validates the session itself; this only handles page redirects.
export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const loggedIn = Boolean(context.cookies.get("cl_session"));

  if (url.pathname === "/") {
    return loggedIn ? Response.redirect(new URL("/dashboard", url), 302) : undefined;
  }

  if (!loggedIn) {
    return Response.redirect(new URL("/login", url), 302);
  }
};

export const config: Config = {
  path: [
    "/",
    "/personal",
    "/education",
    "/skills",
    "/interests",
    "/projects",
    "/assessment",
    "/analysis",
    "/matches",
    "/skill-gap",
    "/roadmap",
    "/interview",
    "/feedback",
    "/report",
    "/dashboard",
  ],
};
