import Link from 'next/link'
import { BuyMeACoffee } from '@/components/BuyMeACoffee'
import { ContainerOuter } from '@/components/Container'
import { SelfTriagingDemo } from '@/components/demo/SelfTriagingDemo'
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
    <ContainerOuter className="py-20 sm:py-24">
      <div className="relative px-4 sm:px-8 lg:px-12">
        <section className="mt-10">
          <div>
            <SelfTriagingDemo />
          </div>
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
              <SocialLink
                href={GITHUB_URL}
                label="GitHub"
                icon={GitHubIcon}
              />
              <SocialLink
                href={LINKEDIN_URL}
                label="LinkedIn"
                icon={LinkedInIcon}
              />
            </div>
            <p className="mx-auto mb-4 max-w-xl text-center text-sm text-zinc-500 italic dark:text-zinc-400">
              If this demo was useful, you can help keep the AI tokens flowing
              and support future experiments.
            </p>
            <div className="mt-6 flex items-center justify-center gap-x-6">
              <BuyMeACoffee />
            </div>
          </section>
        </section>
      </div>
    </ContainerOuter>
  )
}
