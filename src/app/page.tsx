import Link from 'next/link'
import { BuyMeACoffee } from '@/components/BuyMeACoffee'
import { Container } from '@/components/Container'
import {
  GitHubIcon,
  InstagramIcon,
  LinkedInIcon,
  SubstackIcon,
} from '@/components/SocialIcons'

const SUBSTACK_URL = process.env.NEXT_PUBLIC_SUBSTACK_URL as string
const INSTAGRAM_URL = process.env.NEXT_PUBLIC_INSTAGRAM_URL as string
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL as string
const LINKEDIN_URL = process.env.NEXT_PUBLIC_LINKEDIN_URL as string
const TAGLINE = process.env.NEXT_PUBLIC_TAGLINE as string

function SocialLink({
  href,
  label,
  icon: Icon,
}: {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="group -m-1 p-1"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon className="h-6 w-6 fill-zinc-500 transition group-hover:fill-zinc-700 dark:fill-zinc-400 dark:group-hover:fill-zinc-200" />
    </Link>
  )
}

export default function HomePage() {
  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto w-full max-w-2xl">
        <header className="space-y-3">
          <p className="text-sm font-medium tracking-wide text-sky-700 uppercase dark:text-sky-400">
            REUSABLE STARTER
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl dark:text-slate-100">
            {TAGLINE}
          </h1>
        </header>

        <section className="mt-10">
          <div className="prose prose-lg max-w-none prose-slate dark:prose-invert prose-headings:tracking-tight">
            <p>
              I built this starter to remove setup noise from small projects.
            </p>
            <p>
              It’s Next.js and Tailwind, stripped down to the pieces I actually use. Nothing extra. Just defaults you can depend on.</p>
            <p>
              The goal is consistency. Same structure, same patterns, same
              baseline decisions, so I can focus on the work instead of
              rebuilding scaffolding.
            </p>
            <p>
              You can use it as-is or fork it and shape it around your own
              standards.
            </p>
            <div className="not-prose mt-4">
              <Link
                href="https://github.com/PudparK/next-brand-kit"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                aria-label="View next-brand-kit on GitHub"
              >
                <svg
                  viewBox="0 0 98 96"
                  aria-hidden="true"
                  className="h-5 w-5 fill-current"
                >
                  <path d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" />
                </svg>
                <span>View template on GitHub →</span>
              </Link>
            </div>
          </div>

          <section className="mt-10">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">
              Includes:
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-base text-slate-700 dark:text-slate-300">
              <li>App router baseline structure</li>
              <li>Tailwind + typography defaults</li>
              <li>SEO + metadata setup</li>
              <li>Linting and formatting defaults</li>
              <li>Reusable layout/components</li>
            </ul>
          </section>

          <section className="mt-12 border-t border-zinc-200 pt-8 dark:border-zinc-700/40">
            <div className="mb-6 flex items-center justify-center gap-4">
              <SocialLink
                href={SUBSTACK_URL}
                label="Substack"
                icon={SubstackIcon}
              />
              <SocialLink
                href={INSTAGRAM_URL}
                label="Instagram"
                icon={InstagramIcon}
              />
              <SocialLink href={GITHUB_URL} label="GitHub" icon={GitHubIcon} />
              <SocialLink
                href={LINKEDIN_URL}
                label="LinkedIn"
                icon={LinkedInIcon}
              />
            </div>
            <p className="mx-auto mb-4 max-w-xl text-center text-sm text-zinc-500 italic dark:text-zinc-400">
              If this starter or my writing helped you ship faster, you can
              support the work with a coffee.
            </p>
            <div className="mt-6 flex items-center justify-center gap-x-6">
              <BuyMeACoffee />
            </div>
          </section>
        </section>
      </div>
    </Container>
  )
}
