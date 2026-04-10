import clsx from 'clsx'
import Link from 'next/link'
import { CubeTransparentIcon } from '@heroicons/react/24/outline'
import type { ComponentPropsWithoutRef } from 'react'

type AvatarProps = Omit<ComponentPropsWithoutRef<typeof Link>, 'href'> & {
  large?: boolean
}

export default function Avatar({
  large = false,
  className,
  ...props
}: AvatarProps) {
  return (
    <Link
      href="/"
      aria-label="Home"
      className={clsx(className, 'pointer-events-auto')}
      {...props}
    >
      <span
        className={clsx(
          'flex items-center justify-center rounded-full bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
          large ? 'h-16 w-16' : 'h-10 w-10',
        )}
      >
        <CubeTransparentIcon className={clsx(large ? 'h-8 w-8' : 'h-5 w-5')} />
      </span>
    </Link>
  )
}
