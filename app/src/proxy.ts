import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isPublic = createRouteMatcher(["/", "/login", "/signup"]);
const isAuthRoute = createRouteMatcher(["/login", "/signup"]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const isAuthenticated = await convexAuth.isAuthenticated();

  if (isAuthRoute(request) && isAuthenticated) {
    return nextjsMiddlewareRedirect(request, "/app");
  }
  if (!isPublic(request) && !isAuthenticated) {
    return nextjsMiddlewareRedirect(request, "/login");
  }
});

export const config = {
  // Skip Next.js internals and static files
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
};
