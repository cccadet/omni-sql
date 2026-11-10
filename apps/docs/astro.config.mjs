// @ts-check
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";
import { base, repoUrl, sections, site } from "./pages.mjs";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  // Images are served as-is from public/: keeps animated GIFs intact and avoids sharp.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "omni-sql docs",
      description: "Documentation for omni-sql, an open-source SQL IDE with local DuckDB analysis.",
      logo: { src: "./src/assets/omni-sql.svg", alt: "omni-sql" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "GitHub", href: repoUrl }],
      customCss: ["./src/styles/theme.css"],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        pt: { label: "Português", lang: "pt-BR" },
      },
      sidebar: sections.map((section) => ({
        label: section.label,
        translations: section.translations,
        items: section.pages.map((page) => (page.label ? { slug: page.slug, label: page.label } : page.slug)),
      })),
      head: [
        { tag: "link", attrs: { rel: "home", href: "https://cccadet.github.io/omni-sql/" } },
      ],
    }),
  ],
});
