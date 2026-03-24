# next-brand-kit

Reusable personal starter built with Next.js App Router, Tailwind CSS v4, Headless UI, and TypeScript.

## Quick Start

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run lint` - lint `src` with ESLint

## Environment Variables

Copy `.env.example` to `.env.local` and set your values:

- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_TAGLINE`
- `NEXT_PUBLIC_SUBSTACK_URL`
- `NEXT_PUBLIC_INSTAGRAM_URL`
- `NEXT_PUBLIC_GITHUB_URL`
- `NEXT_PUBLIC_LINKEDIN_URL`
- `NEXT_PUBLIC_BUY_ME_A_COFFEE_URL`

These are used by homepage hero content, social links, support CTA, and metadata.

## How To Make It Yours

1. Update `.env.local` with your brand values and links.
2. Replace homepage body copy in `src/app/page.tsx`.
3. Update site metadata in `src/app/layout.tsx` (`title`, `description`, Open Graph, Twitter).
4. Replace social preview image at `public/graph-image.png`.
5. Update avatar and personal imagery (`src/images/avatar.jpg`, any images in `public/`).
6. Adjust navigation/footer labels in `src/components/Header.tsx` and `src/components/Footer.tsx`.
7. Run `npm run lint` and `npm run build` before deploy.

## Social Preview Image

Share previews use:

- `public/graph-image.png`

Configured in `src/app/layout.tsx` via Open Graph and Twitter metadata.

## Main Files

- `src/app/layout.tsx` - app shell, providers, metadata
- `src/app/page.tsx` - landing page content and social/support sections
- `src/components/Header.tsx` - top navigation + theme toggle
- `src/components/Footer.tsx` - footer navigation
- `src/components/BuyMeACoffee.tsx` - support button
- `src/styles/tailwind.css` - Tailwind + typography plugin setup
