import type { Metadata } from 'next'

import { Header } from '@/components/Header'
import { Footer } from '@/components/Footer'
import { Providers } from '@/app/providers'

import '@/styles/tailwind.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: 'Next.js Tailwind + Headless UI Template',
  description: 'A minimal reusable starter template.',
  openGraph: {
    title: 'Next.js Tailwind + Headless UI Template',
    description: 'A minimal reusable starter template.',
    images: ['/graph-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Next.js Tailwind + Headless UI Template',
    description: 'A minimal reusable starter template.',
    images: ['/graph-image.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <Providers>
          <Header />
          <div className="flex min-h-screen flex-col">
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
      </body>
    </html>
  )
}
