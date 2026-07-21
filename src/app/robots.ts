import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // the admin panel and its endpoints are private, never for the index
      disallow: ["/admin", "/api/admin"],
    },
    sitemap: "https://webgpu.in/sitemap.xml",
  };
}
