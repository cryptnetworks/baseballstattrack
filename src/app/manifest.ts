import type { MetadataRoute } from "next";

const applicationName = "Baseball Stat Track";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: applicationName,
    short_name: "Stat Track",
    description: "Online-first baseball scorekeeping and statistics.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#176b4d",
    categories: ["sports", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
